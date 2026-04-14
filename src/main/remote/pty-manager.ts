import pty from 'node-pty';
import { ChannelType, encodeBinaryFrame, decodeBinaryFrame } from './protocol';

type PtyEntry = {
  ptyProcess: pty.IPty;
  tmuxSession: string;
};

export class PtyManager {
  private entries = new Map<number, PtyEntry>();
  private nextChannelId = 1;

  constructor(private onFrame: (frame: Buffer) => void) {}

  attach(tmuxSession: string, cols: number, rows: number): number {
    const channelId = this.nextChannelId++;

    const ptyProcess = pty.spawn('tmux', ['attach', '-t', tmuxSession], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: process.env.HOME,
      env: { ...process.env, TERM: 'xterm-256color' } as Record<string, string>,
    });

    ptyProcess.onData((data: string) => {
      const frame = encodeBinaryFrame({
        channelType: ChannelType.PTY_DATA,
        channelId,
        payload: Buffer.from(data),
      });
      this.onFrame(frame);
    });

    ptyProcess.onExit(() => {
      this.entries.delete(channelId);
    });

    this.entries.set(channelId, { ptyProcess, tmuxSession });
    return channelId;
  }

  handleInput(data: Buffer): void {
    const frame = decodeBinaryFrame(data);
    const entry = this.entries.get(frame.channelId);
    if (!entry) return;
    entry.ptyProcess.write(frame.payload.toString());
  }

  resize(channelId: number, cols: number, rows: number): void {
    const entry = this.entries.get(channelId);
    if (!entry) return;
    entry.ptyProcess.resize(cols, rows);
  }

  detach(channelId: number): void {
    const entry = this.entries.get(channelId);
    if (!entry) return;
    entry.ptyProcess.kill();
    this.entries.delete(channelId);
  }

  isAttached(channelId: number): boolean {
    return this.entries.has(channelId);
  }

  destroyAll(): void {
    for (const [id, entry] of this.entries) {
      entry.ptyProcess.kill();
    }
    this.entries.clear();
  }
}
