import type { WorkspaceAppState, WindowInfo, BranchInfo, Result } from '../../../main/domain/types';

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

  /**
   * Whether this transport is the authoritative owner of the renderer's
   * `windows` slice while it's the active transport. When true, the
   * renderer's local 1Hz state push must NOT overwrite `windows` —
   * `switchSession` and the TabBar's optimistic updates own that field.
   * When false, the local poll is the source of truth.
   *
   * Local transports run on the same Electron process as the state poll,
   * so the poll always knows the active session and can rebuild windows
   * authoritatively. Remote transports leave the local poll blind, so
   * the transport's own `switchSession` result must be preserved.
   */
  readonly ownsWindows: boolean;

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

  // ── Session creation ───────────────────────────────────────────
  /** Returns the new session's id on success. */
  createWorkspaceSession(workspaceName: string, workspaceDir: string, label?: string): Promise<Result<string>>;
  createRepoSession(workspaceName: string, repoRoot: string, mode: 'directory' | 'worktree', branch?: string, base?: string): Promise<Result<string>>;
  createStandaloneSession(label: string, dir: string): Promise<Result<string>>;
  /** List git branches at `repoRoot`. Returns `[]` on failure (e.g. remote disconnected). */
  getBranches(repoRoot: string): Promise<BranchInfo[]>;

  // ── Lifecycle ──────────────────────────────────────────────────
  /**
   * Called when the transport becomes inactive — clean up listeners,
   * detach PTY channels, etc. Idempotent.
   */
  detach(): void;
}
