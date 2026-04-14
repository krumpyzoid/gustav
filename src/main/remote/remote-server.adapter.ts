import https from 'node:https';
import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import { encodeControlMessage } from './protocol';

export type ServerConfig = {
  port: number;
  cert: string;
  key: string;
  bindAddress?: string; // default: '0.0.0.0'
};

const MAX_FAILED_AUTH = 5;
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute

export class RemoteServerAdapter {
  private httpsServer: https.Server | null = null;
  private wss: WebSocketServer | null = null;
  private client: WebSocket | null = null;
  private clientIp: string | null = null;

  private connectionHandler: (() => void) | null = null;
  private disconnectionHandler: (() => void) | null = null;
  private messageHandler: ((data: string) => void) | null = null;
  private binaryMessageHandler: ((data: Buffer) => void) | null = null;

  private failedAuthAttempts = new Map<string, number[]>();

  constructor(private config: ServerConfig) {}

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.httpsServer = https.createServer({
        cert: this.config.cert,
        key: this.config.key,
      });

      this.wss = new WebSocketServer({ server: this.httpsServer, maxPayload: 1 * 1024 * 1024 });

      this.wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
        if (this.client) {
          // Reject — already have a client
          ws.send(encodeControlMessage({
            type: 'error',
            id: 'reject',
            payload: { message: 'Another client is already connected' },
          }));
          ws.close();
          return;
        }

        this.client = ws;
        this.clientIp = req.socket.remoteAddress ?? null;
        this.connectionHandler?.();

        ws.on('message', (data: Buffer | string, isBinary: boolean) => {
          if (isBinary) {
            this.binaryMessageHandler?.(Buffer.isBuffer(data) ? data : Buffer.from(data as unknown as ArrayBuffer));
          } else {
            this.messageHandler?.(data.toString());
          }
        });

        ws.on('close', () => {
          if (this.client === ws) {
            this.client = null;
            this.disconnectionHandler?.();
          }
        });

        // 'close' always fires after 'error' on ws, so let close handler
        // handle disconnection — don't fire handler here to avoid double-call
        ws.on('error', () => {});
      });

      this.httpsServer.on('error', reject);
      this.httpsServer.listen(this.config.port, this.config.bindAddress ?? '0.0.0.0', () => resolve());
    });
  }

  async stop(): Promise<void> {
    if (this.client) {
      this.client.close();
      this.client = null;
    }
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }
    return new Promise((resolve) => {
      if (this.httpsServer) {
        this.httpsServer.close(() => {
          this.httpsServer = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  onConnection(handler: () => void): void {
    this.connectionHandler = handler;
  }

  onDisconnection(handler: () => void): void {
    this.disconnectionHandler = handler;
  }

  onMessage(handler: (data: string) => void): void {
    this.messageHandler = handler;
  }

  onBinaryMessage(handler: (data: Buffer) => void): void {
    this.binaryMessageHandler = handler;
  }

  sendText(data: string): void {
    if (this.client?.readyState === WebSocket.OPEN) {
      this.client.send(data);
    }
  }

  sendBinary(data: Buffer): void {
    if (this.client?.readyState === WebSocket.OPEN) {
      this.client.send(data);
    }
  }

  hasClient(): boolean {
    return this.client !== null && this.client.readyState === WebSocket.OPEN;
  }

  disconnectClient(): void {
    if (this.client) {
      const ws = this.client;
      this.client = null; // Null first so close handler guard passes
      ws.close();         // close event will fire, but guard (this.client === ws) is false → no double-fire
      this.disconnectionHandler?.();
    }
  }

  getClientAddress(): string | null {
    return this.clientIp;
  }

  // ── Rate limiting ──────────────────────────────────────────────────
  recordFailedAuth(ip: string): void {
    const now = Date.now();
    const attempts = this.failedAuthAttempts.get(ip) ?? [];
    attempts.push(now);
    this.failedAuthAttempts.set(ip, attempts);
  }

  isRateLimited(ip: string): boolean {
    const now = Date.now();
    const attempts = this.failedAuthAttempts.get(ip);
    if (!attempts) return false;

    // Filter to recent attempts within the window
    const recent = attempts.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
    this.failedAuthAttempts.set(ip, recent);

    return recent.length >= MAX_FAILED_AUTH;
  }
}

