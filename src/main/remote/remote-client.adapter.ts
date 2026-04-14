import WebSocket from 'ws';
import crypto from 'node:crypto';

export class RemoteClientAdapter {
  private ws: WebSocket | null = null;
  private url: string | null = null;
  private reconnecting = false;
  private shouldReconnect = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private pinnedCertFingerprint: string | null = null;

  private connectedHandler: (() => void) | null = null;
  private disconnectedHandler: (() => void) | null = null;
  private messageHandler: ((data: string) => void) | null = null;
  private binaryMessageHandler: ((data: Buffer) => void) | null = null;

  onConnected(handler: () => void): void { this.connectedHandler = handler; }
  onDisconnected(handler: () => void): void { this.disconnectedHandler = handler; }
  onMessage(handler: (data: string) => void): void { this.messageHandler = handler; }
  onBinaryMessage(handler: (data: Buffer) => void): void { this.binaryMessageHandler = handler; }

  async connect(url: string): Promise<void> {
    this.url = url;
    this.shouldReconnect = true;
    this.reconnectDelay = 1000;
    return this.doConnect();
  }

  setPinnedCertFingerprint(fingerprint: string): void {
    this.pinnedCertFingerprint = fingerprint;
  }

  getPinnedCertFingerprint(): string | null {
    return this.pinnedCertFingerprint;
  }

  disconnect(): void {
    this.shouldReconnect = false;
    this.reconnecting = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.disconnectedHandler?.();
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  sendText(data: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    }
  }

  sendBinary(data: Buffer): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    }
  }

  private doConnect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.url) return reject(new Error('No URL set'));

      const wsOpts: Record<string, unknown> = {
        // On first connect (no pinned cert), accept any cert (TOFU)
        // On reconnect, we'll verify the pinned fingerprint
        rejectUnauthorized: false,
      };

      this.ws = new WebSocket(this.url, wsOpts);

      this.ws.on('upgrade', (response) => {
        // Pin the server's TLS certificate on first connection
        const socket = response.socket as import('tls').TLSSocket;
        const cert = socket.getPeerCertificate?.();
        if (cert?.fingerprint256) {
          if (!this.pinnedCertFingerprint) {
            // First connection — pin the cert (TOFU)
            this.pinnedCertFingerprint = cert.fingerprint256;
          } else if (this.pinnedCertFingerprint !== cert.fingerprint256) {
            // Cert changed — reject (possible MITM)
            this.ws?.close();
            reject(new Error('Server certificate changed — re-pair required'));
            return;
          }
        }
      });

      this.ws.on('open', () => {
        this.reconnecting = false;
        this.reconnectDelay = 1000;
        this.connectedHandler?.();
        resolve();
      });

      this.ws.on('message', (data: Buffer | string, isBinary: boolean) => {
        if (isBinary) {
          this.binaryMessageHandler?.(Buffer.isBuffer(data) ? data : Buffer.from(data as unknown as ArrayBuffer));
        } else {
          this.messageHandler?.(data.toString());
        }
      });

      this.ws.on('close', () => {
        this.ws = null;
        if (this.shouldReconnect && !this.reconnecting) {
          this.reconnecting = true;
          this.disconnectedHandler?.();
          this.scheduleReconnect();
        }
      });

      this.ws.on('error', (err) => {
        this.ws = null;
        if (this.reconnecting) {
          // Error during reconnect — schedule another attempt
          this.scheduleReconnect();
        } else if (this.shouldReconnect) {
          this.reconnecting = true;
          this.scheduleReconnect();
          reject(err);
        } else {
          reject(err);
        }
      });
    });
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect) return;

    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.doConnect();
      } catch {
        // Will auto-retry via close handler
      }
    }, this.reconnectDelay);

    // Exponential backoff, max 30s
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30_000);
  }
}
