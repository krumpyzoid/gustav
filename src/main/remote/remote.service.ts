import { existsSync, mkdirSync, readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { RemoteServerAdapter } from './remote-server.adapter';
import { AuthService, type AuthStorage } from './auth.service';
import { CommandDispatcher } from './command-dispatcher';
import { PtyManager } from './pty-manager';
import { TunnelManager } from './tunnel-manager';
import { generateSelfSignedCert, type TlsCert } from './crypto';
import { decodeControlMessage, encodeControlMessage, ChannelType, decodeBinaryFrame } from './protocol';
import type { StateService } from '../services/state.service';
import type { SessionService } from '../services/session.service';
import type { WorkspaceService } from '../services/workspace.service';
import type { GitPort } from '../ports/git.port';
import type { TmuxPort } from '../ports/tmux.port';
import type { ShellPort } from '../ports/shell.port';

export type RemoteServiceDeps = {
  stateService: StateService;
  workspaceService: WorkspaceService;
  sessionLifecycle: import('../services/session-lifecycle.service').SessionLifecycleService;
  supervisor: import('../supervisor/supervisor.port').SessionSupervisorPort;
  git: GitPort;
  tmux: TmuxPort;
  shell: ShellPort;
  dataDir: string;
};

export type HostInfo = {
  enabled: boolean;
  port: number | null;
  pairingCode: string | null;
  pairingExpiresAt: number | null;
  clientConnected: boolean;
  clientAddress: string | null;
};

export class RemoteService {
  private server: RemoteServerAdapter | null = null;
  private auth: AuthService | null = null;
  private dispatcher: CommandDispatcher;
  private ptyManager: PtyManager | null = null;
  private tunnelManager: TunnelManager | null = null;
  private port: number | null = null;
  private authenticated = false;
  private clientAddress: string | null = null;
  private messageQueue = Promise.resolve();
  private authTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(private deps: RemoteServiceDeps) {
    this.dispatcher = new CommandDispatcher({
      stateService: deps.stateService,
      workspaceService: deps.workspaceService,
      sessionLifecycle: deps.sessionLifecycle,
      git: deps.git,
      tmux: deps.tmux,
      isAllowedDirectory: (dir) => this.isAllowedDirectory(dir),
    });
  }

  async start(port: number): Promise<void> {
    this.port = port;
    const remoteDir = join(this.deps.dataDir, 'remote');
    if (!existsSync(remoteDir)) mkdirSync(remoteDir, { recursive: true, mode: 0o700 });

    // Load or generate TLS cert
    const tlsCert = this.loadOrGenerateCert(remoteDir);

    // Create auth service with file-backed storage
    const authStorage: AuthStorage = {
      read: (path) => {
        const fullPath = join(remoteDir, path);
        try { return readFileSync(fullPath, 'utf-8'); } catch { return null; }
      },
      write: (path, data) => {
        writeFileSync(join(remoteDir, path), data, { encoding: 'utf-8', mode: 0o600 });
      },
    };
    this.auth = new AuthService(authStorage);
    this.auth.generatePairingCode();

    // Create server
    this.server = new RemoteServerAdapter({ port, cert: tlsCert.cert, key: tlsCert.key });

    // Wire up server events
    this.server.onConnection(() => {
      this.authenticated = false;
      this.clientAddress = this.server?.getClientAddress() ?? null;
      // E3: Kick unauthenticated clients after 30 seconds
      this.authTimeout = setTimeout(() => {
        if (!this.authenticated) {
          this.server?.disconnectClient();
        }
      }, 30_000);
    });

    this.server.onDisconnection(() => {
      this.teardownManagers();
    });

    this.server.onMessage((data) => {
      // Serialize async message processing to prevent TOCTOU races (C3)
      this.messageQueue = this.messageQueue
        .then(() => this.handleTextMessage(data))
        .catch(() => {});
    });

    this.server.onBinaryMessage((data) => {
      this.handleBinaryMessage(data);
    });

    await this.server.start();
  }

  async stop(): Promise<void> {
    this.teardownManagers();
    await this.server?.stop();
    this.server = null;
    this.auth = null;
    this.port = null;
    this.authenticated = false;
    this.clientAddress = null;
  }

  getHostInfo(): HostInfo {
    if (!this.server || !this.auth) {
      return { enabled: false, port: null, pairingCode: null, pairingExpiresAt: null, clientConnected: false, clientAddress: null };
    }

    const code = this.auth.getCurrentPairingCode();
    return {
      enabled: true,
      port: this.port,
      pairingCode: code?.code ?? null,
      pairingExpiresAt: code?.expiresAt ?? null,
      clientConnected: this.server.hasClient() && this.authenticated,
      clientAddress: this.clientAddress,
    };
  }

  regenerateCode(): void {
    this.auth?.generatePairingCode();
  }

  disconnectClient(): void {
    this.server?.disconnectClient();
  }

  broadcastState(state: unknown): void {
    if (!this.server?.hasClient() || !this.authenticated) return;
    this.server.sendText(encodeControlMessage({
      type: 'state-update',
      id: `state-${Date.now()}`,
      payload: state as Record<string, unknown>,
    }));
  }

  // ── Private ────────────────────────────────────────────────────────
  private async handleTextMessage(data: string): Promise<void> {
    try {
      const msg = decodeControlMessage(data);

      if (msg.type === 'auth') {
        await this.handleAuth(msg.payload);
        return;
      }

      if (!this.authenticated) {
        this.server?.sendText(encodeControlMessage({
          type: 'error',
          id: msg.id,
          payload: { message: 'Not authenticated' },
        }));
        return;
      }

      if (msg.type === 'session-command') {
        const { action, ...params } = msg.payload as Record<string, unknown>;
        if (action === 'attach-pty') {
          this.handleAttachPty(msg.id, params);
          return;
        }
        if (action === 'detach-pty') {
          this.handleDetachPty(params);
          return;
        }
        if (action === 'resize-pty') {
          this.handleResizePty(params);
          return;
        }
        // Dispatch as a regular command
        const result = await this.dispatcher.dispatch(action as string, params);
        this.server?.sendText(encodeControlMessage({
          type: 'session-command',
          id: msg.id,
          payload: result as unknown as Record<string, unknown>,
        }));
        return;
      }

      if (msg.type === 'port-event') {
        await this.handlePortEvent(msg.id, msg.payload);
        return;
      }

      // Reject unrecognized message types — no open dispatch
      this.server?.sendText(encodeControlMessage({
        type: 'error',
        id: msg.id,
        payload: { message: `Unknown message type: ${msg.type}` },
      }));
    } catch (e) {
      // Ignore malformed messages
    }
  }

  private async handleAuth(payload: Record<string, unknown>): Promise<void> {
    if (!this.auth || !this.server) return;

    const clientIp = this.server.getClientAddress() ?? 'unknown';

    // S2: Enforce rate limiting before processing auth
    if (this.server.isRateLimited(clientIp)) {
      this.server.sendText(encodeControlMessage({
        type: 'auth',
        id: 'rate-limited',
        payload: { success: false, message: 'Too many failed attempts. Try again later.' },
      }));
      return;
    }

    const method = payload.method as string;

    if (method === 'pair') {
      const code = payload.code as string;
      if (this.auth.verifyPairingCode(code)) {
        const clientPubKey = payload.publicKey as string;
        const clientId = this.auth.completePairing(clientPubKey);
        this.authenticated = true;
        if (this.authTimeout) { clearTimeout(this.authTimeout); this.authTimeout = null; }
        this.server.sendText(encodeControlMessage({
          type: 'auth',
          id: 'pair-ok',
          payload: {
            success: true,
            clientId,
            serverPublicKey: this.auth.getServerPublicKey(),
          },
        }));
      } else {
        this.server.recordFailedAuth(clientIp);
        this.server.sendText(encodeControlMessage({
          type: 'auth',
          id: 'pair-fail',
          payload: { success: false, message: 'Invalid pairing code' },
        }));
      }
      return;
    }

    if (method === 'challenge-response') {
      const nonce = this.auth.generateChallenge();
      this.server.sendText(encodeControlMessage({
        type: 'auth',
        id: 'challenge',
        payload: { nonce },
      }));
      return;
    }

    if (method === 'verify') {
      const { publicKey, signature } = payload as { publicKey: string; signature: string };
      // S3: Sign the server's own current challenge, not client-supplied nonce
      const serverSig = this.auth.signCurrentChallenge();
      if (this.auth.verifyChallengeResponse(publicKey, signature)) {
        this.authenticated = true;
        if (this.authTimeout) { clearTimeout(this.authTimeout); this.authTimeout = null; }
        this.server.sendText(encodeControlMessage({
          type: 'auth',
          id: 'verify-ok',
          payload: { success: true, serverSignature: serverSig },
        }));
      } else {
        this.server.recordFailedAuth(clientIp);
        this.server.sendText(encodeControlMessage({
          type: 'auth',
          id: 'verify-fail',
          payload: { success: false, message: 'Authentication failed' },
        }));
      }
    }
  }

  private handleAttachPty(msgId: string, params: Record<string, unknown>): void {
    if (!this.ptyManager) {
      this.ptyManager = new PtyManager(
        (frame) => { this.server?.sendBinary(frame); },
        this.deps.supervisor,
      );
    }

    const session = params.tmuxSession as string;

    // S4: Validate tmux session name — only allow Gustav-managed sessions.
    // Stricter for attach-pty: require an actual persisted session, not
    // just a known workspace prefix.
    if (!this.isKnownSession(session) || !this.isPersistedSession(session)) {
      this.server?.sendText(encodeControlMessage({
        type: 'session-command',
        id: msgId,
        payload: { success: false, error: 'Unknown or invalid session' },
      }));
      return;
    }

    const cols = (params.cols as number) || 80;
    const rows = (params.rows as number) || 24;

    // Backend dispatch: native-supervisor sessions cannot be reached via
    // `tmux attach`; route them through the supervisor data plane instead.
    const backend = this.deps.workspaceService.resolveBackend(session);
    const channelId = backend === 'native'
      ? this.ptyManager.attachSupervisor(session, cols, rows)
      : this.ptyManager.attachTmux(session, cols, rows);

    // Result envelope shape — `data` carries command-specific data so the
    // renderer's `result.data` reads consistently across all commands.
    this.server?.sendText(encodeControlMessage({
      type: 'session-command',
      id: msgId,
      payload: { success: true, data: { channelId } },
    }));
  }

  private handleDetachPty(params: Record<string, unknown>): void {
    const channelId = params.channelId as number;
    this.ptyManager?.detach(channelId);
  }

  private handleResizePty(params: Record<string, unknown>): void {
    const channelId = params.channelId as number;
    const cols = params.cols as number;
    const rows = params.rows as number;
    this.ptyManager?.resize(channelId, cols, rows);
  }

  private handleBinaryMessage(data: Buffer): void {
    if (!this.authenticated) return;
    const frame = decodeBinaryFrame(data);
    if (frame.channelType === ChannelType.PTY_INPUT) {
      this.ptyManager?.handleInput(data);
    } else if (frame.channelType === ChannelType.PORT_TUNNEL) {
      this.tunnelManager?.handleData(data);
    }
  }

  private async handlePortEvent(msgId: string, payload: Record<string, unknown>): Promise<void> {
    const action = payload.action as string;

    if (action === 'forward') {
      if (!this.tunnelManager) {
        this.tunnelManager = new TunnelManager((frame) => {
          this.server?.sendBinary(frame);
        });
      }
      const port = payload.port as number;
      const result = await this.tunnelManager.createTunnel(port);
      this.server?.sendText(encodeControlMessage({
        type: 'port-event',
        id: msgId,
        payload: result as unknown as Record<string, unknown>,
      }));
      return;
    }

    if (action === 'stop-forward') {
      const channelId = payload.channelId as number;
      this.tunnelManager?.destroyTunnel(channelId);
      this.server?.sendText(encodeControlMessage({
        type: 'port-event',
        id: msgId,
        payload: { success: true },
      }));
    }
  }

  private teardownManagers(): void {
    if (this.authTimeout) { clearTimeout(this.authTimeout); this.authTimeout = null; }
    this.authenticated = false;
    this.clientAddress = null;
    this.ptyManager?.destroyAll();
    this.tunnelManager?.destroyAll();
    this.ptyManager = null;
    this.tunnelManager = null;
  }

  /** S4: Check if a tmux session name is managed by Gustav.
   * Stricter than the regex-only check it replaces — also rejects `..`,
   * empty path components, and leading `-` (could be parsed as a tmux flag).
   * For attach-pty, callers should additionally require that the session
   * matches an actual persisted entry (see `isPersistedSession`). */
  private isKnownSession(session: string): boolean {
    if (typeof session !== 'string' || session.length === 0 || session.length > 256) return false;
    if (!/^[\w][\w\-. /]*$/.test(session)) return false; // must start with word char
    const segments = session.split('/');
    if (segments.some((s) => s === '' || s === '.' || s === '..')) return false;
    const ws = this.deps.workspaceService.findBySessionPrefix(session);
    if (ws) return true;
    if (session.startsWith('_standalone/') && segments.length === 2) return true;
    return false;
  }

  /** Stronger gate for attach-pty: require an actual persisted session, not
   * just a known workspace prefix. Closes the gap where any
   * `<known-workspace>/<arbitrary>` value would pass `isKnownSession`. */
  private isPersistedSession(session: string): boolean {
    const ws = this.deps.workspaceService.findBySessionPrefix(session);
    if (ws) {
      const persisted = this.deps.workspaceService.getPersistedSessions(ws.id);
      return persisted.some((s) => s.tmuxSession === session);
    }
    // Standalone sessions aren't persisted today, so allow them through if
    // they have the correct prefix shape.
    return session.startsWith('_standalone/');
  }

  /** Validate directory is within a known workspace root (resolves symlinks) */
  private isAllowedDirectory(dir: string): boolean {
    let resolved: string;
    try { resolved = realpathSync(dir); } catch { resolved = resolve(dir); }
    const workspaces = this.deps.workspaceService.list();
    return workspaces.some((ws) => {
      let wsRoot: string;
      try { wsRoot = realpathSync(ws.directory); } catch { wsRoot = resolve(ws.directory); }
      const root = wsRoot.endsWith('/') ? wsRoot : wsRoot + '/';
      return resolved === wsRoot || resolved.startsWith(root);
    });
  }

  private loadOrGenerateCert(dir: string): TlsCert {
    const certPath = join(dir, 'server.cert');
    const keyPath = join(dir, 'server.key');

    try {
      const cert = readFileSync(certPath, 'utf-8');
      const key = readFileSync(keyPath, 'utf-8');
      if (cert && key) return { cert, key };
    } catch {
      // Generate new cert
    }

    const tlsCert = generateSelfSignedCert();
    writeFileSync(certPath, tlsCert.cert, { mode: 0o600 });
    writeFileSync(keyPath, tlsCert.key, { mode: 0o600 });
    return tlsCert;
  }
}
