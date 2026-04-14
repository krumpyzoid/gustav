import net from 'node:net';
import { ChannelType, encodeBinaryFrame, decodeBinaryFrame } from './protocol';

type TunnelEntry = {
  socket: net.Socket;
  remotePort: number;
};

type TunnelResult =
  | { success: true; channelId: number }
  | { success: false; error: string };

export class TunnelManager {
  private tunnels = new Map<number, TunnelEntry>();
  private nextChannelId = 1;
  private allowedPorts: Set<number> | null = null; // null = unrestricted (for local use), Set = allowlist

  constructor(private onFrame: (frame: Buffer) => void) {}

  /** Set the allowed ports (from detected ports). Only these can be tunneled. */
  setAllowedPorts(ports: number[]): void {
    this.allowedPorts = new Set(ports);
  }

  async createTunnel(remotePort: number): Promise<TunnelResult> {
    if (remotePort < 1024) {
      return { success: false, error: `Privileged ports (< 1024) are not allowed` };
    }
    if (this.allowedPorts && !this.allowedPorts.has(remotePort)) {
      return { success: false, error: `Port ${remotePort} is not in the allowed list. Start a dev server in a Gustav session first.` };
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
