import type { WorkspaceAppState, WindowInfo, BranchInfo, Result } from '../../../main/domain/types';
import type { SessionTransport } from './session-transport';

/**
 * Hook for the transport to learn the currently focused session id. Defaults
 * to reading from `window.api.getState()`-driven app store on demand. Tests
 * inject a no-op or a stub.
 */
export type ActiveSessionGetter = () => string | null;

/**
 * LocalTransport — adapts the local IPC bridge (`window.api`) to the
 * `SessionTransport` port. All methods are thin delegators; the entire
 * point of this class is to give the renderer a single dispatch surface
 * regardless of where the session actually lives.
 *
 * Active subscription cleanups are tracked so `detach()` can release them
 * deterministically when the transport is swapped out.
 *
 * Phase 3 strangler: PTY data from the in-process `NativeSupervisor` arrives
 * on a separate IPC channel (`supervisor:on-data`). LocalTransport
 * multiplexes both streams into the same `onPtyData` listener so the
 * terminal hook stays unaware of which backend produced the bytes — the
 * supervisor stream is filtered by the renderer's currently-active session
 * id to avoid cross-session bleed.
 */
export class LocalTransport implements SessionTransport {
  readonly kind = 'local' as const;

  private cleanups = new Set<() => void>();
  private getActiveSession: ActiveSessionGetter;

  constructor(getActiveSession?: ActiveSessionGetter) {
    this.getActiveSession = getActiveSession ?? defaultActiveSessionGetter;
  }

  // ── PTY data plane ─────────────────────────────────────────────
  sendPtyInput(data: string): void {
    const active = this.getActiveSession();
    // TODO(Phase 3.5): once per-session backend is tracked on the
    // renderer (the app store will know which sessions are native vs
    // tmux), branch on that here instead of dual-writing. The current
    // dual-dispatch is a strangler artefact that contradicts the
    // single-arbiter intent in docs/specs/architecture-evolution.md
    // (Decision 4) — supervisor and tmux both see every keystroke
    // until the renderer can pick the right one.
    if (active) {
      try { window.api.supervisor?.sendInput(active, data); } catch { /* noop */ }
    }
    window.api.sendPtyInput(data);
  }

  sendPtyResize(cols: number, rows: number): void {
    window.api.sendPtyResize(cols, rows);
    // Mirror to the supervisor for the active session so the native PTY
    // sees the same SIGWINCH the tmux PTY does. The supervisor is the
    // single arbiter; absent a registered client this is a best-effort
    // call.
    const active = this.getActiveSession();
    if (active) {
      try {
        window.api.supervisor?.resizeClient({
          sessionId: active,
          clientId: 'local-renderer',
          cols,
          rows,
        });
      } catch { /* noop */ }
    }
  }

  onPtyData(listener: (data: string) => void): () => void {
    // Tmux-side PTY stream (legacy backend).
    const tmuxCleanup = window.api.onPtyData(listener);
    // Supervisor-side stream, filtered by active session so concurrent
    // sessions on the supervisor don't bleed into the focused terminal.
    const superCleanup = window.api.supervisor?.onData(({ sessionId, data }) => {
      const active = this.getActiveSession();
      if (active && sessionId !== active) return;
      listener(data);
    });
    const composite = () => {
      tmuxCleanup();
      superCleanup?.();
    };
    return this.track(composite);
  }

  // ── State subscription ─────────────────────────────────────────
  getState(): Promise<WorkspaceAppState> {
    return window.api.getState();
  }

  onStateUpdate(listener: (state: WorkspaceAppState) => void): () => void {
    const cleanup = window.api.onStateUpdate(listener);
    return this.track(cleanup);
  }

  // ── Session lifecycle commands ─────────────────────────────────
  async switchSession(session: string): Promise<Result<WindowInfo[]>> {
    // Best-effort attach: if the session is supervisor-owned the supervisor
    // needs a client to drive its latest-wins size policy. Sending an
    // attach for a tmux-only session is a no-op (the supervisor returns
    // silently on unknown sessionId via `requireSession` — guarded by a
    // try/catch here so we never block the switch).
    try {
      window.api.supervisor?.attachClient({
        sessionId: session,
        clientId: 'local-renderer',
        cols: 80,
        rows: 24,
      });
    } catch { /* noop */ }
    return window.api.switchSession(session);
  }

  sleepSession(session: string): Promise<Result<void>> {
    return window.api.sleepSession(session);
  }

  wakeSession(session: string): Promise<Result<WindowInfo[]>> {
    return window.api.wakeSession(session);
  }

  destroySession(session: string): Promise<Result<void>> {
    return window.api.destroySession(session);
  }

  // ── Window commands ────────────────────────────────────────────
  selectWindow(session: string, windowName: string): Promise<Result<void>> {
    return window.api.selectWindow(session, windowName);
  }

  newWindow(session: string, name: string): Promise<Result<void>> {
    return window.api.newWindow(session, name);
  }

  killWindow(session: string, windowIndex: number): Promise<Result<void>> {
    return window.api.killWindow(session, windowIndex);
  }

  setWindowOrder(session: string, names: string[]): Promise<Result<void>> {
    return window.api.setWindowOrder(session, names);
  }

  // ── Session creation ───────────────────────────────────────────
  createWorkspaceSession(workspaceName: string, workspaceDir: string, label?: string): Promise<Result<string>> {
    return window.api.createWorkspaceSession(workspaceName, workspaceDir, label);
  }

  createRepoSession(workspaceName: string, repoRoot: string, mode: 'directory' | 'worktree', branch?: string, base?: string): Promise<Result<string>> {
    return window.api.createRepoSession(workspaceName, repoRoot, mode, branch, base);
  }

  createStandaloneSession(label: string, dir: string): Promise<Result<string>> {
    return window.api.createStandaloneSession(label, dir);
  }

  getBranches(repoRoot: string): Promise<BranchInfo[]> {
    return window.api.getBranches(repoRoot);
  }

  // ── Lifecycle ──────────────────────────────────────────────────
  detach(): void {
    for (const cleanup of this.cleanups) cleanup();
    this.cleanups.clear();
  }

  /**
   * Wraps an underlying cleanup so that we forget it once consumers call it
   * directly (and so that `detach()` doesn't double-invoke a released listener).
   */
  private track(cleanup: () => void): () => void {
    this.cleanups.add(cleanup);
    return () => {
      if (this.cleanups.delete(cleanup)) cleanup();
    };
  }
}

/**
 * Lazy reader for the renderer's active session id. Lazy-imports
 * `use-app-state` to avoid a circular module dependency at construction
 * time. Falls back to `null` when the store hasn't initialized.
 */
function defaultActiveSessionGetter(): string | null {
  try {
    // Lazy require to avoid a circular import (use-app-state defaults to
    // `new LocalTransport()` at module init).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('../../hooks/use-app-state') as typeof import('../../hooks/use-app-state');
    return mod.useAppStore.getState().activeSession;
  } catch {
    return null;
  }
}
