import net from 'node:net';
import { ChannelType, encodeBinaryFrame, decodeBinaryFrame } from './protocol';

type TunnelEntry = {
  socket: net.Socket;
  remotePort: number;
};

type TunnelResult =
  | { success: true; channelId: number }
  | { success: false; error: string };

// Ports that must never be tunneled — sensitive local services
const BLOCKED_PORTS = new Set([22, 25, 53, 3306, 5432, 6379, 27017]);
// Exclude cloud metadata endpoint range
const BLOCKED_HOSTS = ['169.254.169.254'];

export class TunnelManager {
  private tunnels = new Map<number, TunnelEntry>();
  private nextChannelId = 1;

  constructor(private onFrame: (frame: Buffer) => void) {}

  async createTunnel(remotePort: number): Promise<TunnelResult> {
    if (BLOCKED_PORTS.has(remotePort)) {
      return { success: false, error: `Port ${remotePort} is blocked for security reasons` };
    }
    if (remotePort < 1024) {
      return { success: false, error: `Privileged ports (< 1024) are not allowed` };
    }
    const channelId = this.nextChannelId++;

    return new Promise((resolve) => {
      let connected = false;
      const socket = net.createConnection({ host: '127.0.0.1', port: remotePort }, () => {
        connected = true;
        this.tunnels.set(channelId, { socket, remotePort });

        socket.on('data', (data) => {
          const frame = encodeBinaryFrame({
            channelType: ChannelType.PORT_TUNNEL,
            channelId,
            payload: data,
          });
          this.onFrame(frame);
        });

        socket.on('close', () => {
          this.tunnels.delete(channelId);
        });

        resolve({ success: true, channelId });
      });

      socket.on('error', (err) => {
        if (connected) {
          socket.destroy();
          this.tunnels.delete(channelId);
        } else {
          resolve({ success: false, error: err.message });
        }
      });
    });
  }

  handleData(data: Buffer): void {
    const frame = decodeBinaryFrame(data);
    const entry = this.tunnels.get(frame.channelId);
    if (!entry) return;
    entry.socket.write(frame.payload);
  }

  destroyTunnel(channelId: number): void {
    const entry = this.tunnels.get(channelId);
    if (!entry) return;
    entry.socket.destroy();
    this.tunnels.delete(channelId);
  }

  isActive(channelId: number): boolean {
    return this.tunnels.has(channelId);
  }

  destroyAll(): void {
    for (const [, entry] of this.tunnels) {
      entry.socket.destroy();
    }
    this.tunnels.clear();
  }
}
