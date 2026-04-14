import { RemoteClientAdapter } from './remote-client.adapter';
import { ClientTunnelManager } from './client-tunnel-manager';
import { decodeControlMessage, encodeControlMessage, encodeBinaryFrame, ChannelType, decodeBinaryFrame } from './protocol';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

export class RemoteClientService {
  private adapter: RemoteClientAdapter;
  private tunnelManager: ClientTunnelManager | null = null;
  private status: ConnectionStatus = 'disconnected';

  private stateHandler: ((state: any) => void) | null = null;
  private ptyDataHandler: ((data: Buffer) => void) | null = null;
  private statusHandler: ((status: ConnectionStatus) => void) | null = null;

  constructor() {
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
      id: `cmd-${Date.now()}`,
      payload: { action, ...params },
    }));
  }

  sendAuth(payload: Record<string, unknown>): void {
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

  private handleMessage(data: string): void {
    try {
      const msg = decodeControlMessage(data);

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
