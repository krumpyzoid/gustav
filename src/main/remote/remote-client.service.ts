import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import crypto from 'node:crypto';
import { RemoteClientAdapter } from './remote-client.adapter';
import { ClientTunnelManager } from './client-tunnel-manager';
import { generateEd25519KeyPair, signChallenge, type KeyPair } from './crypto';
import { decodeControlMessage, encodeControlMessage, encodeBinaryFrame, ChannelType, decodeBinaryFrame } from './protocol';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

export type SavedServer = {
  id: string;
  label: string;
  host: string;
  port: number;
  serverPublicKey: string;
  certFingerprint: string;
  pairedAt: string;
};

export class RemoteClientService {
  private adapter: RemoteClientAdapter;
  private tunnelManager: ClientTunnelManager | null = null;
  private status: ConnectionStatus = 'disconnected';
  private pendingResponses = new Map<string, (payload: Record<string, unknown>) => void>();
  private dataDir: string;
  private clientKeys: KeyPair;
  private currentServerId: string | null = null;

  private stateHandler: ((state: any) => void) | null = null;
  private ptyDataHandler: ((data: Buffer) => void) | null = null;
  private statusHandler: ((status: ConnectionStatus) => void) | null = null;

  constructor(dataDir: string) {
    this.dataDir = join(dataDir, 'remote');
    if (!existsSync(this.dataDir)) mkdirSync(this.dataDir, { recursive: true });
    this.clientKeys = this.loadOrGenerateClientKeys();
    this.adapter = new RemoteClientAdapter();

    this.adapter.onConnected(() => {
      this.setStatus('connected');
    });

    this.adapter.onDisconnected(() => {
      if (this.status === 'connected' || this.status === 'connecting') {
        this.setStatus('reconnecting');
      }
    });

    this.adapter.onMessage((data) => {
      this.handleMessage(data);
    });

    this.adapter.onBinaryMessage((data) => {
      this.handleBinary(data);
    });
  }

  onStateUpdate(handler: (state: any) => void): void {
    this.stateHandler = handler;
  }

  onPtyData(handler: (data: Buffer) => void): void {
    this.ptyDataHandler = handler;
  }

  onStatusChange(handler: (status: ConnectionStatus) => void): void {
    this.statusHandler = handler;
  }

  async connect(url: string): Promise<void> {
    this.setStatus('connecting');
    await this.adapter.connect(url);
  }

  disconnect(): void {
    this.adapter.disconnect();
    this.tunnelManager?.destroyAll();
    this.tunnelManager = null;
    this.setStatus('disconnected');
  }

  getConnectionStatus(): ConnectionStatus {
    return this.status;
  }

  sendCommand(action: string, params: Record<string, unknown> = {}): void {
    this.adapter.sendText(encodeControlMessage({
      type: 'session-command',
      id: `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      payload: { action, ...params },
    }));
  }

  /** Send a command and wait for the server's response by matching message ID */
  async sendCommandAndWait(action: string, params: Record<string, unknown> = {}, timeoutMs = 10_000): Promise<Record<string, unknown>> {
    const id = `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingResponses.delete(id);
        reject(new Error(`Command '${action}' timed out`));
      }, timeoutMs);

      this.pendingResponses.set(id, (payload) => {
        clearTimeout(timer);
        this.pendingResponses.delete(id);
        resolve(payload);
      });

      this.adapter.sendText(encodeControlMessage({
        type: 'session-command',
        id,
        payload: { action, ...params },
      }));
    });
  }

  sendAuth(payload: Record<string, unknown>): void {
    // Auto-include client public key in pair requests
    if (payload.method === 'pair' && !payload.publicKey) {
      payload.publicKey = this.clientKeys.publicKey;
    }
    this.adapter.sendText(encodeControlMessage({
      type: 'auth',
      id: `auth-${Date.now()}`,
      payload,
    }));
  }

  sendPtyInput(channelId: number, data: string): void {
    this.adapter.sendBinary(encodeBinaryFrame({
      channelType: ChannelType.PTY_INPUT,
      channelId,
      payload: Buffer.from(data),
    }));
  }

  sendPtyResize(channelId: number, cols: number, rows: number): void {
    this.adapter.sendText(encodeControlMessage({
      type: 'session-command',
      id: `resize-${Date.now()}`,
      payload: { action: 'resize-pty', channelId, cols, rows },
    }));
  }

  async forwardPort(remotePort: number, localPort: number, channelId: number): Promise<{ success: boolean; error?: string }> {
    if (!this.tunnelManager) {
      this.tunnelManager = new ClientTunnelManager((frame) => {
        this.adapter.sendBinary(frame);
      });
    }
    const result = await this.tunnelManager.startForward(remotePort, localPort, channelId);
    return result.success ? { success: true } : { success: false, error: result.error };
  }

  stopForward(channelId: number): void {
    this.tunnelManager?.stopForward(channelId);
  }

  // ── Saved servers ──────────────────────────────────────────────────
  getSavedServers(): SavedServer[] {
    try {
      const raw = readFileSync(join(this.dataDir, 'saved_servers.json'), 'utf-8');
      return JSON.parse(raw) as SavedServer[];
    } catch {
      return [];
    }
  }

  saveServer(host: string, port: number, serverPublicKey: string, label?: string): SavedServer {
    const servers = this.getSavedServers();
    // Update existing or create new
    const existing = servers.find((s) => s.host === host && s.port === port);
    const certFingerprint = this.adapter.getPinnedCertFingerprint() ?? '';

    if (existing) {
      existing.serverPublicKey = serverPublicKey;
      existing.certFingerprint = certFingerprint;
      existing.pairedAt = new Date().toISOString();
      if (label) existing.label = label;
      this.writeSavedServers(servers);
      return existing;
    }

    const server: SavedServer = {
      id: crypto.randomBytes(8).toString('hex'),
      label: label ?? host,
      host,
      port,
      serverPublicKey,
      certFingerprint,
      pairedAt: new Date().toISOString(),
    };
    servers.push(server);
    this.writeSavedServers(servers);
    return server;
  }

  deleteSavedServer(id: string): void {
    const servers = this.getSavedServers().filter((s) => s.id !== id);
    this.writeSavedServers(servers);
  }

  /** Connect to a previously paired server using key-based auth */
  async connectToSaved(server: SavedServer): Promise<void> {
    this.currentServerId = server.id;
    // Restore the pinned cert fingerprint
    if (server.certFingerprint) {
      this.adapter.setPinnedCertFingerprint(server.certFingerprint);
    }

    this.setStatus('connecting');
    await this.adapter.connect(`wss://${server.host}:${server.port}`);

    // Initiate challenge-response auth
    this.sendAuth({ method: 'challenge-response' });
    // The server will respond with a nonce — handled in handleMessage
  }

  getClientPublicKey(): string {
    return this.clientKeys.publicKey;
  }

  /** Called when auth response arrives — handles pairing save and challenge-response flow */
  private handleAuthResponse(payload: Record<string, unknown>): void {
    if (payload.nonce) {
      // Challenge received — sign it and send back
      const nonce = payload.nonce as string;
      const signature = signChallenge(nonce, this.clientKeys.privateKey);
      this.sendAuth({
        method: 'verify',
        publicKey: this.clientKeys.publicKey,
        signature,
        nonce,
      });
      return;
    }

    if (payload.success && payload.serverPublicKey) {
      // Pairing succeeded — auto-save the server
      const url = this.adapter['url']; // access private field for host extraction
      if (url) {
        try {
          const parsed = new URL(url);
          this.saveServer(
            parsed.hostname,
            parseInt(parsed.port, 10),
            payload.serverPublicKey as string,
          );
        } catch {}
      }
    }
  }

  private writeSavedServers(servers: SavedServer[]): void {
    writeFileSync(join(this.dataDir, 'saved_servers.json'), JSON.stringify(servers, null, 2), { encoding: 'utf-8', mode: 0o600 });
  }

  private loadOrGenerateClientKeys(): KeyPair {
    const keyPath = join(this.dataDir, 'client_identity.json');
    try {
      const raw = readFileSync(keyPath, 'utf-8');
      const parsed = JSON.parse(raw) as KeyPair;
      if (parsed.publicKey && parsed.privateKey) return parsed;
    } catch {}
    const keys = generateEd25519KeyPair();
    writeFileSync(keyPath, JSON.stringify(keys, null, 2), { encoding: 'utf-8', mode: 0o600 });
    return keys;
  }

  private handleMessage(data: string): void {
    try {
      const msg = decodeControlMessage(data);

      // Check for pending request-response
      const pending = this.pendingResponses.get(msg.id);
      if (pending) {
        pending(msg.payload);
        return;
      }

      if (msg.type === 'auth') {
        this.handleAuthResponse(msg.payload);
        return;
      }

      if (msg.type === 'state-update') {
        this.stateHandler?.(msg.payload);
      }
    } catch {
      // Ignore malformed messages
    }
  }

  private handleBinary(data: Buffer): void {
    const frame = decodeBinaryFrame(data);

    if (frame.channelType === ChannelType.PTY_DATA) {
      this.ptyDataHandler?.(data);
    } else if (frame.channelType === ChannelType.PORT_TUNNEL) {
      this.tunnelManager?.handleData(data);
    }
  }

  private setStatus(status: ConnectionStatus): void {
    this.status = status;
    this.statusHandler?.(status);
  }
}
