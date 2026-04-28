import type { WorkspaceAppState, WindowInfo, Result } from '../../../main/domain/types';
import type { SessionTransport } from './session-transport';

/**
 * LocalTransport — adapts the local IPC bridge (`window.api`) to the
 * `SessionTransport` port. All methods are thin delegators; the entire
 * point of this class is to give the renderer a single dispatch surface
 * regardless of where the session actually lives.
 *
 * Active subscription cleanups are tracked so `detach()` can release them
 * deterministically when the transport is swapped out.
 */
export class LocalTransport implements SessionTransport {
  readonly kind = 'local' as const;

  private cleanups = new Set<() => void>();

  // ── PTY data plane ─────────────────────────────────────────────
  sendPtyInput(data: string): void {
    window.api.sendPtyInput(data);
  }

  sendPtyResize(cols: number, rows: number): void {
    window.api.sendPtyResize(cols, rows);
  }

  onPtyData(listener: (data: string) => void): () => void {
    const cleanup = window.api.onPtyData(listener);
    return this.track(cleanup);
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
  switchSession(session: string): Promise<Result<WindowInfo[]>> {
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
