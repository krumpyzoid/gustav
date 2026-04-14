import net from 'node:net';
import { ChannelType, encodeBinaryFrame, decodeBinaryFrame } from './protocol';

type ForwardEntry = {
  server: net.Server;
  channelId: number;
  remotePort: number;
  localPort: number;
  clients: Set<net.Socket>;
};

type ForwardResult =
  | { success: true; localPort: number; channelId: number }
  | { success: false; error: string };

export class ClientTunnelManager {
  private forwards = new Map<number, ForwardEntry>();

  constructor(private onFrame: (frame: Buffer) => void) {}

  async startForward(remotePort: number, localPort: number, channelId: number): Promise<ForwardResult> {
    return new Promise((resolve) => {
      const clients = new Set<net.Socket>();

      const server = net.createServer((socket) => {
        clients.add(socket);

        socket.on('data', (data) => {
          const frame = encodeBinaryFrame({
            channelType: ChannelType.PORT_TUNNEL,
            channelId,
            payload: data,
          });
          this.onFrame(frame);
        });

        socket.on('close', () => {
          clients.delete(socket);
        });

        socket.on('error', () => {
          socket.destroy();
          clients.delete(socket);
        });
      });

      server.on('error', (err: NodeJS.ErrnoException) => {
        resolve({ success: false, error: err.message });
      });

      server.listen(localPort, '127.0.0.1', () => {
        this.forwards.set(channelId, { server, channelId, remotePort, localPort, clients });
        resolve({ success: true, localPort, channelId });
      });
    });
  }

  handleData(data: Buffer): void {
    const frame = decodeBinaryFrame(data);
    const entry = this.forwards.get(frame.channelId);
    if (!entry) return;

    // Write to all connected TCP clients
    for (const client of entry.clients) {
      if (!client.destroyed) {
        client.write(frame.payload);
      }
    }
  }

  stopForward(channelId: number): void {
    const entry = this.forwards.get(channelId);
    if (!entry) return;

    for (const client of entry.clients) {
      client.destroy();
    }
    entry.server.close();
    this.forwards.delete(channelId);
  }

  destroyAll(): void {
    for (const [channelId] of this.forwards) {
      this.stopForward(channelId);
    }
  }

  isActive(channelId: number): boolean {
    return this.forwards.has(channelId);
  }
}
