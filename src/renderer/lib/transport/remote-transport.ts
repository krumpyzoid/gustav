import type { WorkspaceAppState, WindowInfo, BranchInfo, Result } from '../../../main/domain/types';
import type { SessionTransport } from './session-transport';

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
    const cleanup = window.api.onRemotePtyData(listener);
    return this.track(cleanup);
  }

  // ── State subscription ─────────────────────────────────────────

  /**
   * The remote IPC's `get-state` is fire-and-forget today, so this method
   * has no useful synchronous return path. The renderer's
   * `useAppStateSubscription` does not call this — remote state arrives
   * exclusively via `onStateUpdate`. We surface a clear error rather than
   * silently returning a fake value.
   */
  getState(): Promise<WorkspaceAppState> {
    return Promise.reject(new Error(
      'RemoteGustavTransport.getState is not supported by the current remote IPC; subscribe via onStateUpdate instead',
    ));
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
  async switchSession(session: string): Promise<Result<WindowInfo[]>> {
    if (this.ptyChannelId !== null) {
      window.api.remoteSessionCommand('detach-pty', { channelId: this.ptyChannelId });
      this.ptyChannelId = null;
    }

    const attach = await window.api.remoteSessionCommand(
      'attach-pty',
      { tmuxSession: session, cols: 80, rows: 24 },
    );
    if (!attach.success) {
      return { success: false, error: attach.error ?? 'attach-pty failed' };
    }
    const channelId = (attach.data as { channelId?: unknown })?.channelId;
    if (typeof channelId !== 'number') {
      return { success: false, error: 'attach-pty did not return a channelId' };
    }
    this.ptyChannelId = channelId;

    const windows = await window.api.remoteSessionCommand('list-windows', { session });
    if (!windows.success) {
      return { success: false, error: windows.error ?? 'list-windows failed' };
    }
    return { success: true, data: (windows.data as WindowInfo[]) ?? [] };
  }

  async sleepSession(session: string): Promise<Result<void>> {
    const r = await window.api.remoteSessionCommand('sleep-session', { session });
    return toVoidResult(r);
  }

  async wakeSession(session: string): Promise<Result<WindowInfo[]>> {
    const r = await window.api.remoteSessionCommand('wake-session', { session });
    if (!r.success) return { success: false, error: r.error ?? 'wake-session failed' };
    // wake-session itself returns ok(undefined); a follow-up list-windows
    // gives the windows. Mirror the local switchSession contract.
    const windows = await window.api.remoteSessionCommand('list-windows', { session });
    if (!windows.success) return { success: false, error: windows.error ?? 'list-windows failed' };
    return { success: true, data: (windows.data as WindowInfo[]) ?? [] };
  }

  async destroySession(session: string): Promise<Result<void>> {
    const r = await window.api.remoteSessionCommand('destroy-session', { session });
    return toVoidResult(r);
  }

  // ── Window commands ────────────────────────────────────────────
  async selectWindow(session: string, windowName: string): Promise<Result<void>> {
    const r = await window.api.remoteSessionCommand(
      'select-window',
      { session, window: windowName },
    );
    return toVoidResult(r);
  }

  async newWindow(session: string, name: string): Promise<Result<void>> {
    const r = await window.api.remoteSessionCommand('new-window', { session, name });
    return toVoidResult(r);
  }

  async killWindow(session: string, windowIndex: number): Promise<Result<void>> {
    const r = await window.api.remoteSessionCommand('kill-window', { session, windowIndex });
    return toVoidResult(r);
  }

  async setWindowOrder(session: string, names: string[]): Promise<Result<void>> {
    const r = await window.api.remoteSessionCommand('set-window-order', { session, names });
    return toVoidResult(r);
  }

  // ── Session creation ───────────────────────────────────────────
  async createWorkspaceSession(workspaceName: string, workspaceDir: string, label?: string): Promise<Result<string>> {
    const r = await window.api.remoteSessionCommand('create-workspace-session', { workspaceName, workspaceDir, label });
    return toStringResult(r);
  }

  async createRepoSession(workspaceName: string, repoRoot: string, mode: 'directory' | 'worktree', branch?: string, base?: string): Promise<Result<string>> {
    const r = await window.api.remoteSessionCommand('create-repo-session', { workspaceName, repoRoot, mode, branch, base });
    return toStringResult(r);
  }

  async createStandaloneSession(label: string, dir: string): Promise<Result<string>> {
    const r = await window.api.remoteSessionCommand('create-standalone-session', { label, dir });
    return toStringResult(r);
  }

  async getBranches(repoRoot: string): Promise<BranchInfo[]> {
    const r = await window.api.remoteSessionCommand('get-branches', { repoRoot });
    if (!r.success) return [];
    return (r.data as BranchInfo[]) ?? [];
  }

  // ── Lifecycle ──────────────────────────────────────────────────
  detach(): void {
    if (this.ptyChannelId !== null) {
      window.api.remoteSessionCommand('detach-pty', { channelId: this.ptyChannelId });
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
