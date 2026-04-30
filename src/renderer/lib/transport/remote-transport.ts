import type { WorkspaceAppState, WindowInfo, BranchInfo, Result } from '../../../main/domain/types';
import type { SessionTransport } from './session-transport';
import { RemoteCommand } from '../../../shared/remote-commands';

/**
 * RemoteGustavTransport — adapts the WebSocket-backed remote IPC to the
 * `SessionTransport` port. Holds the currently attached PTY channel id;
 * `switchSession` performs the attach/detach handshake so that callers
 * don't have to know about channel ids at all.
 *
 * PTY methods are no-ops (with a console.warn) when called before a PTY
 * is attached. Throwing here would break callers during the early
 * lifecycle when a remote session is in transition (e.g., after a
 * connection drop, before the next attach completes).
 */
export class RemoteGustavTransport implements SessionTransport {
  readonly kind = 'remote' as const;
  readonly ownsWindows = true;

  private ptyChannelId: number | null = null;
  private cleanups = new Set<() => void>();

  // ── PTY data plane ─────────────────────────────────────────────
  sendPtyInput(data: string): void {
    if (this.ptyChannelId === null) {
      console.warn('RemoteGustavTransport.sendPtyInput called before attach — dropping');
      return;
    }
    window.api.sendRemotePtyInput(this.ptyChannelId, data);
  }

  sendPtyResize(cols: number, rows: number): void {
    if (this.ptyChannelId === null) {
      console.warn('RemoteGustavTransport.sendPtyResize called before attach — dropping');
      return;
    }
    window.api.sendRemotePtyResize(this.ptyChannelId, cols, rows);
  }

  onPtyData(listener: (data: string) => void): () => void {
    // Filter by this transport's channel id so frames from a not-yet-
    // detached previous channel don't bleed into a new transport's
    // listener after a swap. Without this filter the user sees the OLD
    // session's content for the duration of the OLD detach-pty round-
    // trip on the server, which can read like a 3-5s lag if state
    // collection or other slow ops are queued ahead of the detach.
    //
    // ptyChannelId is null until switchSession resolves; frames received
    // before then are dropped, which is correct — there's no channel for
    // them to belong to yet.
    const cleanup = window.api.onRemotePtyData(({ channelId, data }) => {
      if (channelId !== this.ptyChannelId) return;
      listener(data);
    });
    return this.track(cleanup);
  }

  // ── State subscription ─────────────────────────────────────────

  /**
   * Round-trips through `remoteSessionCommand('get-state', {})` — the
   * dispatcher already supports this command and returns the remote's
   * `WorkspaceAppState`. The renderer's `useAppStateSubscription` continues
   * to use `onStateUpdate` for live pushes; this method exists for callers
   * that need a one-shot snapshot.
   */
  async getState(): Promise<WorkspaceAppState> {
    const r = await window.api.remoteSessionCommand(RemoteCommand.GetState, {});
    if (!r.success) throw new Error(r.error || 'get-state failed');
    return r.data as WorkspaceAppState;
  }

  onStateUpdate(listener: (state: WorkspaceAppState) => void): () => void {
    const cleanup = window.api.onRemoteStateUpdate(listener);
    return this.track(cleanup);
  }

  // ── Session lifecycle commands ─────────────────────────────────

  /**
   * For remote sessions, switching = attaching a PTY channel + fetching
   * the window list. We detach any previous channel first to keep the
   * server's per-channel bookkeeping clean.
   */
  async switchSession(session: string, opts?: { cols: number; rows: number }): Promise<Result<WindowInfo[]>> {
    if (this.ptyChannelId !== null) {
      window.api.remoteSessionCommand(RemoteCommand.DetachPty, { channelId: this.ptyChannelId });
      this.ptyChannelId = null;
    }

    // Fall back to 80x24 only when the caller doesn't know the size yet (rare —
    // call sites should always pass the live terminal cols/rows, see #14).
    const cols = opts?.cols ?? 80;
    const rows = opts?.rows ?? 24;
    const attach = await window.api.remoteSessionCommand(
      RemoteCommand.AttachPty,
      { tmuxSession: session, cols, rows },
    );
    if (!attach.success) {
      return { success: false, error: attach.error ?? 'attach-pty failed' };
    }
    const channelId = (attach.data as { channelId?: unknown })?.channelId;
    if (typeof channelId !== 'number') {
      return { success: false, error: 'attach-pty did not return a channelId' };
    }
    this.ptyChannelId = channelId;

    const windows = await window.api.remoteSessionCommand(RemoteCommand.ListWindows, { session });
    if (!windows.success) {
      return { success: false, error: windows.error ?? 'list-windows failed' };
    }
    return { success: true, data: (windows.data as WindowInfo[]) ?? [] };
  }

  async sleepSession(session: string): Promise<Result<void>> {
    const r = await window.api.remoteSessionCommand(RemoteCommand.SleepSession, { session });
    return toVoidResult(r);
  }

  async wakeSession(session: string): Promise<Result<WindowInfo[]>> {
    const r = await window.api.remoteSessionCommand(RemoteCommand.WakeSession, { session });
    if (!r.success) return { success: false, error: r.error ?? 'wake-session failed' };
    const windows = await window.api.remoteSessionCommand(RemoteCommand.ListWindows, { session });
    if (!windows.success) return { success: false, error: windows.error ?? 'list-windows failed' };
    return { success: true, data: (windows.data as WindowInfo[]) ?? [] };
  }

  async destroySession(session: string): Promise<Result<void>> {
    const r = await window.api.remoteSessionCommand(RemoteCommand.DestroySession, { session });
    return toVoidResult(r);
  }

  // ── Window commands ────────────────────────────────────────────
  async selectWindow(session: string, windowName: string): Promise<Result<void>> {
    const r = await window.api.remoteSessionCommand(
      RemoteCommand.SelectWindow,
      { session, window: windowName },
    );
    return toVoidResult(r);
  }

  async newWindow(session: string, name: string): Promise<Result<void>> {
    const r = await window.api.remoteSessionCommand(RemoteCommand.NewWindow, { session, name });
    return toVoidResult(r);
  }

  async killWindow(session: string, windowIndex: number): Promise<Result<void>> {
    const r = await window.api.remoteSessionCommand(RemoteCommand.KillWindow, { session, windowIndex });
    return toVoidResult(r);
  }

  async setWindowOrder(session: string, names: string[]): Promise<Result<void>> {
    const r = await window.api.remoteSessionCommand(RemoteCommand.SetWindowOrder, { session, names });
    return toVoidResult(r);
  }

  // ── Session creation ───────────────────────────────────────────
  async createWorkspaceSession(workspaceName: string, workspaceDir: string, label?: string): Promise<Result<string>> {
    const r = await window.api.remoteSessionCommand(RemoteCommand.CreateWorkspaceSession, { workspaceName, workspaceDir, label });
    return toStringResult(r);
  }

  async createRepoSession(workspaceName: string, repoRoot: string, mode: 'directory' | 'worktree', branch?: string, base?: string): Promise<Result<string>> {
    const r = await window.api.remoteSessionCommand(RemoteCommand.CreateRepoSession, { workspaceName, repoRoot, mode, branch, base });
    return toStringResult(r);
  }

  async createStandaloneSession(label: string, dir: string): Promise<Result<string>> {
    const r = await window.api.remoteSessionCommand(RemoteCommand.CreateStandaloneSession, { label, dir });
    return toStringResult(r);
  }

  async getBranches(repoRoot: string): Promise<BranchInfo[]> {
    const r = await window.api.remoteSessionCommand(RemoteCommand.GetBranches, { repoRoot });
    if (!r.success) return [];
    return (r.data as BranchInfo[]) ?? [];
  }

  // ── Lifecycle ──────────────────────────────────────────────────
  detach(): void {
    if (this.ptyChannelId !== null) {
      window.api.remoteSessionCommand(RemoteCommand.DetachPty, { channelId: this.ptyChannelId });
      this.ptyChannelId = null;
    }
    for (const cleanup of this.cleanups) cleanup();
    this.cleanups.clear();
  }

  /**
   * Wraps an underlying cleanup so that consumers can release a single
   * subscription without leaking; `detach()` releases everything still tracked.
   */
  private track(cleanup: () => void): () => void {
    this.cleanups.add(cleanup);
    return () => {
      if (this.cleanups.delete(cleanup)) cleanup();
    };
  }
}

function toVoidResult(r: Result<unknown>): Result<void> {
  return r.success ? { success: true, data: undefined } : { success: false, error: r.error };
}

function toStringResult(r: Result<unknown>): Result<string> {
  return r.success ? { success: true, data: String(r.data ?? '') } : { success: false, error: r.error };
}
