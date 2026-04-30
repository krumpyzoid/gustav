import pty from 'node-pty';
import type { SessionSupervisorPort } from '../supervisor/supervisor.port';
import { ChannelType, encodeBinaryFrame, decodeBinaryFrame } from './protocol';

type TmuxEntry = {
  kind: 'tmux';
  ptyProcess: pty.IPty;
  tmuxSession: string;
};

type NativeEntry = {
  kind: 'native';
  sessionId: string;
  clientId: string;
  off: () => void;
};

type PtyEntry = TmuxEntry | NativeEntry;

export class PtyManager {
  private entries = new Map<number, PtyEntry>();
  private nextChannelId = 1;

  constructor(
    private onFrame: (frame: Buffer) => void,
    private supervisor?: SessionSupervisorPort,
  ) {}

  /** Attach to a tmux session via `tmux attach`. */
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

    this.entries.set(channelId, { kind: 'tmux', ptyProcess, tmuxSession });
    return channelId;
  }

  /** Attach to a native-supervisor session. Streams data from the active
   * window over a channel and routes input back via the supervisor's
   * latest-wins client model. Idempotent per `sessionId`: if the same
   * session is already attached, returns the existing channel id rather
   * than registering a second listener (which would emit duplicate frames). */
  attachSupervisor(sessionId: string, cols: number, rows: number): number {
    if (!this.supervisor) {
      throw new Error('PtyManager: supervisor not configured for native attach');
    }
    // Reuse an existing native channel for this session to prevent duplicate
    // onWindowData listeners (which would emit duplicate frames to the client).
    for (const [chId, entry] of this.entries) {
      if (entry.kind === 'native' && entry.sessionId === sessionId) {
        return chId;
      }
    }
    const channelId = this.nextChannelId++;
    const clientId = `remote-pty-${channelId}`;

    this.supervisor.attachClient({ sessionId, clientId, cols, rows });

    const off = this.supervisor.onWindowData((sid, _windowId, data) => {
      // Filter to only this session's data; multi-window data for the
      // session all flows on the same channel (matches `tmux attach`).
      if (sid !== sessionId) return;
      const frame = encodeBinaryFrame({
        channelType: ChannelType.PTY_DATA,
        channelId,
        payload: Buffer.from(data),
      });
      this.onFrame(frame);
    });

    this.entries.set(channelId, { kind: 'native', sessionId, clientId, off });
    return channelId;
  }

  handleInput(data: Buffer): void {
    const frame = decodeBinaryFrame(data);
    const entry = this.entries.get(frame.channelId);
    if (!entry) return;
    const text = frame.payload.toString();
    if (entry.kind === 'tmux') {
      entry.ptyProcess.write(text);
    } else {
      this.supervisor?.sendInput(entry.sessionId, text);
    }
  }

  resize(channelId: number, cols: number, rows: number): void {
    const entry = this.entries.get(channelId);
    if (!entry) return;
    if (entry.kind === 'tmux') {
      entry.ptyProcess.resize(cols, rows);
    } else {
      this.supervisor?.resizeClient(entry.sessionId, entry.clientId, cols, rows);
    }
  }

  detach(channelId: number): void {
    const entry = this.entries.get(channelId);
    if (!entry) return;
    if (entry.kind === 'tmux') {
      entry.ptyProcess.kill();
    } else {
      entry.off();
      this.supervisor?.detachClient(entry.sessionId, entry.clientId);
    }
    this.entries.delete(channelId);
  }

  isAttached(channelId: number): boolean {
    return this.entries.has(channelId);
  }

  destroyAll(): void {
    for (const [, entry] of this.entries) {
      if (entry.kind === 'tmux') {
        entry.ptyProcess.kill();
      } else {
        entry.off();
        this.supervisor?.detachClient(entry.sessionId, entry.clientId);
      }
    }
    this.entries.clear();
  }
}
