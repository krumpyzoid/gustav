import type { WorkspaceAppState, WindowInfo, Result } from '../../../main/domain/types';

/**
 * Renderer-side port for talking to a session source.
 *
 * The renderer has exactly one *active* transport at a time. Hooks and
 * components call transport methods; the active transport routes them to
 * either the local IPC bridge (`LocalTransport`) or the remote WebSocket
 * protocol (`RemoteGustavTransport`). New transports (SSH, native
 * supervisor, headless) slot in here without touching call sites.
 *
 * Scope: this port covers the *session* surface — PTY data, state
 * subscription, session/window lifecycle. Workspace management,
 * preferences, theme, file dialogs and worktree CRUD stay on `window.api`
 * directly because they are renderer-environment concerns, not
 * session-transport concerns.
 */
export interface SessionTransport {
  /** Tag for diagnostics and the (rare) place that legitimately needs to differentiate. */
  readonly kind: 'local' | 'remote';

  // ── PTY data plane (fire-and-forget) ────────────────────────────
  sendPtyInput(data: string): void;
  sendPtyResize(cols: number, rows: number): void;
  /** Subscribe to incoming PTY data; returns an unsubscribe function. */
  onPtyData(listener: (data: string) => void): () => void;

  // ── State subscription ─────────────────────────────────────────
  getState(): Promise<WorkspaceAppState>;
  /** Subscribe to whole-state pushes from the source; returns an unsubscribe function. */
  onStateUpdate(listener: (state: WorkspaceAppState) => void): () => void;

  // ── Session lifecycle commands (request/response) ──────────────
  /** Bind the transport to a session. For remote, this attaches a PTY channel. */
  switchSession(session: string): Promise<Result<WindowInfo[]>>;
  sleepSession(session: string): Promise<Result<void>>;
  wakeSession(session: string): Promise<Result<WindowInfo[]>>;
  destroySession(session: string): Promise<Result<void>>;

  // ── Window commands ────────────────────────────────────────────
  selectWindow(session: string, windowName: string): Promise<Result<void>>;
  newWindow(session: string, name: string): Promise<Result<void>>;
  killWindow(session: string, windowIndex: number): Promise<Result<void>>;
  setWindowOrder(session: string, names: string[]): Promise<Result<void>>;

  // ── Lifecycle ──────────────────────────────────────────────────
  /**
   * Called when the transport becomes inactive — clean up listeners,
   * detach PTY channels, etc. Idempotent.
   */
  detach(): void;
}
