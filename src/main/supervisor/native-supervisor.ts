/**
 * NativeSupervisor — owns node-pty processes directly for sessions that opt
 * in via the strangler flag. The single arbiter of PTY size and lifecycle.
 *
 * **Headless-ready:** this file deliberately does not import from `electron`
 * or any renderer-coupled API. The wiring layer (in `src/main/index.ts`)
 * glues the supervisor to Electron IPC; the supervisor itself is pure Node.
 */

import { composeClaudeCommand } from '../domain/claude-command';
import type { WindowSpec } from '../domain/types';
import type { SessionSupervisorPort } from './supervisor.port';
import type {
  ClientView,
  ManagedSession,
  ManagedWindow,
  ManagedWindowState,
} from './types';

/** Minimal IPty-shape used by the supervisor; matches node-pty.IPty. */
export interface SupervisorPty {
  pid: number;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
  onData(cb: (data: string) => void): { dispose: () => void };
  onExit(cb: (e: { exitCode: number; signal?: number }) => void): { dispose: () => void };
}

/** Pluggable spawner (real one wraps node-pty; tests inject a fake). */
export interface SupervisorPtyFactory {
  spawn(
    command: string,
    args: string[],
    options: {
      cwd?: string;
      cols?: number;
      rows?: number;
      env?: Record<string, string>;
      name?: string;
    },
  ): SupervisorPty;
}

/** Subset of AssistantLogPort the supervisor cares about. */
export interface SupervisorAssistantLog {
  track(sessionId: string, cwd: string): void;
  untrack(sessionId: string): void;
}

interface NativeSupervisorOptions {
  ptyFactory: SupervisorPtyFactory;
  /** Login shell to wrap commands in. Defaults to `$SHELL` or `bash`. */
  defaultShell?: string;
  /** Optional environment used for spawned PTYs. Defaults to `process.env`. */
  env?: Record<string, string>;
  /** Optional Claude observer hook for track/untrack. */
  assistantLog?: SupervisorAssistantLog;
  /** Override for the default initial PTY size when no client has attached yet. */
  defaultCols?: number;
  defaultRows?: number;
  /** Per-window scrollback cap in bytes (default 100KB). */
  scrollbackCapBytes?: number;
}

interface InternalWindow extends ManagedWindow {
  pty: SupervisorPty | null;
  ptyDisposers: Array<() => void>;
  scrollback: string;
  /** Tracks what we last sent via pty.resize() so we can suppress duplicates. */
  lastSentSize: { cols: number; rows: number } | null;
}

interface InternalSession extends Omit<ManagedSession, 'windows'> {
  windows: InternalWindow[];
  clients: Map<string, ClientView>;
  attachClock: number;
}

const SCROLLBACK_DEFAULT_CAP = 100 * 1024;

export class NativeSupervisor implements SessionSupervisorPort {
  private readonly factory: SupervisorPtyFactory;
  private readonly defaultShell: string;
  private readonly env: Record<string, string>;
  private readonly assistantLog?: SupervisorAssistantLog;
  private readonly defaultCols: number;
  private readonly defaultRows: number;
  private readonly scrollbackCap: number;

  private readonly sessions = new Map<string, InternalSession>();
  private readonly dataListeners = new Set<
    (sessionId: string, windowId: string, data: string) => void
  >();
  private readonly stateListeners = new Set<(sessionId: string) => void>();
  /** Tracks claude sessionIds we've called observer.track() for. */
  private readonly trackedClaudeIds = new Set<string>();
  private nextWindowId = 1;
  private closed = false;

  constructor(opts: NativeSupervisorOptions) {
    this.factory = opts.ptyFactory;
    this.defaultShell = opts.defaultShell ?? process.env.SHELL ?? 'bash';
    this.env = opts.env ?? (process.env as Record<string, string>);
    this.assistantLog = opts.assistantLog;
    this.defaultCols = opts.defaultCols ?? 80;
    this.defaultRows = opts.defaultRows ?? 24;
    this.scrollbackCap = opts.scrollbackCapBytes ?? SCROLLBACK_DEFAULT_CAP;
  }

  // ── Session lifecycle ───────────────────────────────────────────

  async createSession(opts: {
    sessionId: string;
    cwd: string;
    windows: WindowSpec[];
  }): Promise<void> {
    if (this.closed) throw new Error('Supervisor is closed');
    if (this.sessions.has(opts.sessionId)) {
      throw new Error(`Session "${opts.sessionId}" already exists`);
    }
    if (opts.windows.length === 0) {
      throw new Error('createSession requires at least one window');
    }

    const session: InternalSession = {
      id: opts.sessionId,
      cwd: opts.cwd,
      windows: [],
      activeWindowId: '',
      clients: new Map(),
      attachClock: 0,
    };
    this.sessions.set(opts.sessionId, session);

    for (const spec of opts.windows) {
      this.spawnWindow(session, spec);
    }
    session.activeWindowId = session.windows[0].id;
  }

  async killSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    for (const w of session.windows) {
      this.disposeWindow(w);
    }
    this.sessions.delete(sessionId);
    this.emitState(sessionId);
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  // ── Window lifecycle ────────────────────────────────────────────

  async addWindow(sessionId: string, spec: WindowSpec): Promise<string> {
    const session = this.requireSession(sessionId);
    const win = this.spawnWindow(session, spec);
    this.emitState(sessionId);
    return win.id;
  }

  async killWindow(sessionId: string, windowId: string): Promise<void> {
    const session = this.requireSession(sessionId);
    const idx = session.windows.findIndex((w) => w.id === windowId);
    if (idx === -1) return;
    const win = session.windows[idx];
    this.disposeWindow(win);
    session.windows.splice(idx, 1);
    if (session.activeWindowId === windowId && session.windows.length > 0) {
      session.activeWindowId = session.windows[0].id;
    }
    this.emitState(sessionId);
  }

  async selectWindow(sessionId: string, windowId: string): Promise<void> {
    const session = this.requireSession(sessionId);
    const win = session.windows.find((w) => w.id === windowId);
    if (!win) throw new Error(`Window "${windowId}" not found in session "${sessionId}"`);
    session.activeWindowId = windowId;
    // On switch, ensure the now-active window has the latest client size.
    this.applyLatestSizeToWindow(session, win);
    this.emitState(sessionId);
  }

  listWindows(sessionId: string): ManagedWindow[] {
    const session = this.sessions.get(sessionId);
    if (!session) return [];
    // Return a stable, defensive copy stripped of internal pty handles.
    return session.windows.map((w) => ({
      id: w.id,
      name: w.name,
      spec: w.spec,
      state: w.state,
      exitCode: w.exitCode,
    }));
  }

  // ── Sleep / wake ────────────────────────────────────────────────

  async sleepSession(sessionId: string): Promise<void> {
    const session = this.requireSession(sessionId);
    for (const w of session.windows) {
      this.disposePty(w);
      w.state = 'exited';
    }
    this.emitState(sessionId);
  }

  async wakeSession(sessionId: string): Promise<void> {
    const session = this.requireSession(sessionId);
    // Replace each window with a fresh PTY based on its retained spec.
    const freshWindows: InternalWindow[] = [];
    for (const old of session.windows) {
      const spec = old.spec;
      const replacement = this.makeWindowRecord(spec);
      this.startPtyForWindow(session, replacement);
      freshWindows.push(replacement);
    }
    session.windows = freshWindows;
    session.activeWindowId = session.windows[0]?.id ?? '';
    this.emitState(sessionId);
  }

  // ── Client management ───────────────────────────────────────────

  attachClient(opts: {
    sessionId: string;
    clientId: string;
    cols: number;
    rows: number;
  }): void {
    const session = this.requireSession(opts.sessionId);
    session.attachClock += 1;
    session.clients.set(opts.clientId, {
      clientId: opts.clientId,
      cols: opts.cols,
      rows: opts.rows,
      attachedAt: session.attachClock,
    });
    this.applyLatestSizeToActive(session);
  }

  detachClient(sessionId: string, clientId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.clients.delete(clientId);
    if (session.clients.size > 0) {
      this.applyLatestSizeToActive(session);
    }
  }

  resizeClient(sessionId: string, clientId: string, cols: number, rows: number): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    const client = session.clients.get(clientId);
    if (!client) return;
    client.cols = cols;
    client.rows = rows;
    session.attachClock += 1;
    client.attachedAt = session.attachClock;
    this.applyLatestSizeToActive(session);
  }

  // ── Data plane ──────────────────────────────────────────────────

  sendInput(sessionId: string, data: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    const win = session.windows.find((w) => w.id === session.activeWindowId);
    if (!win || !win.pty || win.state === 'exited') return;
    win.pty.write(data);
  }

  onWindowData(
    listener: (sessionId: string, windowId: string, data: string) => void,
  ): () => void {
    this.dataListeners.add(listener);
    return () => {
      this.dataListeners.delete(listener);
    };
  }

  onSessionStateChange(listener: (sessionId: string) => void): () => void {
    this.stateListeners.add(listener);
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  // ── Replay ──────────────────────────────────────────────────────

  getReplay(sessionId: string, windowId: string): string {
    const session = this.sessions.get(sessionId);
    if (!session) return '';
    const win = session.windows.find((w) => w.id === windowId);
    return win?.scrollback ?? '';
  }

  // ── Lifecycle ───────────────────────────────────────────────────

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const session of this.sessions.values()) {
      for (const w of session.windows) {
        this.disposeWindow(w);
      }
    }
    this.sessions.clear();
    this.dataListeners.clear();
    this.stateListeners.clear();
    this.trackedClaudeIds.clear();
  }

  // ── Internals ───────────────────────────────────────────────────

  private requireSession(sessionId: string): InternalSession {
    const s = this.sessions.get(sessionId);
    if (!s) throw new Error(`Session "${sessionId}" not found`);
    return s;
  }

  private makeWindowRecord(spec: WindowSpec): InternalWindow {
    const id = `w${this.nextWindowId++}`;
    return {
      id,
      name: spec.name,
      spec,
      state: 'spawning',
      exitCode: null,
      pty: null,
      ptyDisposers: [],
      scrollback: '',
      lastSentSize: null,
    };
  }

  private spawnWindow(session: InternalSession, spec: WindowSpec): InternalWindow {
    const win = this.makeWindowRecord(spec);
    this.startPtyForWindow(session, win);
    session.windows.push(win);
    return win;
  }

  private startPtyForWindow(session: InternalSession, win: InternalWindow): void {
    const cwd = win.spec.directory ?? session.cwd;
    const commandLine = this.composeCommandLine(win.spec);
    // Wrap in a login shell so user PATH/aliases work, matching tmux's behavior.
    const args = ['-lc', commandLine];
    const { cols, rows } = this.preferredSizeFor(session);

    const pty = this.factory.spawn(this.defaultShell, args, {
      cwd,
      cols,
      rows,
      env: this.env,
      name: 'xterm-256color',
    });
    win.pty = pty;
    win.state = 'running';
    win.lastSentSize = { cols, rows };

    const dataDisp = pty.onData((data) => this.onPtyData(session, win, data));
    const exitDisp = pty.onExit((e) => this.onPtyExit(session, win, e.exitCode));
    win.ptyDisposers.push(() => dataDisp.dispose(), () => exitDisp.dispose());

    // Claude observer integration.
    if (win.spec.kind === 'claude' && win.spec.claudeSessionId && this.assistantLog) {
      const sid = win.spec.claudeSessionId;
      if (!this.trackedClaudeIds.has(sid)) {
        this.assistantLog.track(sid, cwd);
        this.trackedClaudeIds.add(sid);
      }
    }
  }

  private composeCommandLine(spec: WindowSpec): string {
    if (spec.kind === 'claude') {
      return composeClaudeCommand({ args: spec.args, claudeSessionId: spec.claudeSessionId });
    }
    // 'command' kind: use the literal command (or just the shell if empty).
    const cmd = spec.command?.trim();
    if (!cmd) return 'exec ' + this.defaultShell;
    return cmd;
  }

  private preferredSizeFor(session: InternalSession): { cols: number; rows: number } {
    // Latest-wins: pick the client with the highest attachedAt. If none,
    // fall back to defaults.
    let latest: ClientView | null = null;
    for (const c of session.clients.values()) {
      if (!latest || c.attachedAt > latest.attachedAt) latest = c;
    }
    if (!latest) return { cols: this.defaultCols, rows: this.defaultRows };
    return { cols: latest.cols, rows: latest.rows };
  }

  private applyLatestSizeToActive(session: InternalSession): void {
    const win = session.windows.find((w) => w.id === session.activeWindowId);
    if (win) this.applyLatestSizeToWindow(session, win);
  }

  private applyLatestSizeToWindow(session: InternalSession, win: InternalWindow): void {
    if (!win.pty || win.state !== 'running') return;
    const { cols, rows } = this.preferredSizeFor(session);
    if (
      win.lastSentSize &&
      win.lastSentSize.cols === cols &&
      win.lastSentSize.rows === rows
    ) {
      return;
    }
    win.pty.resize(cols, rows);
    win.lastSentSize = { cols, rows };
  }

  private onPtyData(session: InternalSession, win: InternalWindow, data: string): void {
    // Always buffer.
    this.appendScrollback(win, data);
    // Only forward to listeners if this is the active window.
    if (session.activeWindowId !== win.id) return;
    for (const listener of this.dataListeners) {
      try {
        listener(session.id, win.id, data);
      } catch {
        // Listener errors must not break supervisor state.
      }
    }
  }

  private appendScrollback(win: InternalWindow, data: string): void {
    win.scrollback += data;
    if (win.scrollback.length > this.scrollbackCap) {
      win.scrollback = win.scrollback.slice(win.scrollback.length - this.scrollbackCap);
    }
  }

  private onPtyExit(session: InternalSession, win: InternalWindow, exitCode: number): void {
    win.state = 'exited' as ManagedWindowState;
    win.exitCode = exitCode;
    // Don't auto-respawn. Untrack claude observer if applicable.
    this.untrackIfClaude(win);
    this.emitState(session.id);
  }

  private disposeWindow(win: InternalWindow): void {
    this.disposePty(win);
    this.untrackIfClaude(win);
  }

  private disposePty(win: InternalWindow): void {
    if (win.pty) {
      try {
        win.pty.kill();
      } catch {
        // Ignore — process may already be gone.
      }
    }
    for (const d of win.ptyDisposers) {
      try {
        d();
      } catch {
        // Ignore disposer errors.
      }
    }
    win.ptyDisposers = [];
    win.pty = null;
  }

  private untrackIfClaude(win: InternalWindow): void {
    if (win.spec.kind !== 'claude') return;
    const sid = win.spec.claudeSessionId;
    if (!sid || !this.trackedClaudeIds.has(sid)) return;
    this.trackedClaudeIds.delete(sid);
    this.assistantLog?.untrack(sid);
  }

  private emitState(sessionId: string): void {
    if (this.closed) return;
    for (const listener of this.stateListeners) {
      try {
        listener(sessionId);
      } catch {
        // Listener errors must not break supervisor state.
      }
    }
  }
}
