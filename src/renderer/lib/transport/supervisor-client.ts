import type { ManagedWindow } from '../../../main/supervisor/types';
import type { Result, WindowSpec } from '../../../main/domain/types';

/**
 * Renderer-side wrapper around the supervisor IPC surface.
 *
 * Phase 3 ships this as the strangler-friendly entry point: consumers can
 * import `SupervisorClient` to talk to the in-process `NativeSupervisor`
 * without going through tmux. The transport layer (and hooks) decide which
 * client to use based on `Preferences.sessionSupervisor`.
 *
 * No behavioral coupling to `LocalTransport` or `RemoteGustavTransport` —
 * this client is intentionally isolated so the migration can proceed at a
 * different pace than transport unification.
 */
export class SupervisorClient {
  private cleanups = new Set<() => void>();

  // ── Session lifecycle ────────────────────────────────────────────
  createSession(opts: { sessionId: string; cwd: string; windows: WindowSpec[] }): Promise<Result<void>> {
    return window.api.supervisor.createSession(opts);
  }

  killSession(sessionId: string): Promise<Result<void>> {
    return window.api.supervisor.killSession(sessionId);
  }

  hasSession(sessionId: string): Promise<Result<boolean>> {
    return window.api.supervisor.hasSession(sessionId);
  }

  // ── Window lifecycle ─────────────────────────────────────────────
  addWindow(sessionId: string, spec: WindowSpec): Promise<Result<string>> {
    return window.api.supervisor.addWindow(sessionId, spec);
  }

  killWindow(sessionId: string, windowId: string): Promise<Result<void>> {
    return window.api.supervisor.killWindow(sessionId, windowId);
  }

  selectWindow(sessionId: string, windowId: string): Promise<Result<void>> {
    return window.api.supervisor.selectWindow(sessionId, windowId);
  }

  listWindows(sessionId: string): Promise<Result<ManagedWindow[]>> {
    return window.api.supervisor.listWindows(sessionId);
  }

  // ── Sleep / wake ────────────────────────────────────────────────
  sleepSession(sessionId: string): Promise<Result<void>> {
    return window.api.supervisor.sleepSession(sessionId);
  }

  wakeSession(sessionId: string): Promise<Result<void>> {
    return window.api.supervisor.wakeSession(sessionId);
  }

  // ── Client management ───────────────────────────────────────────
  attachClient(payload: { sessionId: string; clientId: string; cols: number; rows: number }): void {
    window.api.supervisor.attachClient(payload);
  }

  detachClient(sessionId: string, clientId: string): void {
    window.api.supervisor.detachClient(sessionId, clientId);
  }

  resizeClient(payload: { sessionId: string; clientId: string; cols: number; rows: number }): void {
    window.api.supervisor.resizeClient(payload);
  }

  // ── Data plane ──────────────────────────────────────────────────
  sendInput(sessionId: string, data: string): void {
    window.api.supervisor.sendInput(sessionId, data);
  }

  getReplay(sessionId: string, windowId: string): Promise<Result<string>> {
    return window.api.supervisor.getReplay(sessionId, windowId);
  }

  onData(
    cb: (payload: { sessionId: string; windowId: string; data: string }) => void,
  ): () => void {
    const cleanup = window.api.supervisor.onData(cb);
    return this.track(cleanup);
  }

  onStateChange(cb: (payload: { sessionId: string }) => void): () => void {
    const cleanup = window.api.supervisor.onStateChange(cb);
    return this.track(cleanup);
  }

  // ── Lifecycle ───────────────────────────────────────────────────
  detach(): void {
    for (const c of this.cleanups) c();
    this.cleanups.clear();
  }

  private track(cleanup: () => void): () => void {
    this.cleanups.add(cleanup);
    return () => {
      if (this.cleanups.delete(cleanup)) cleanup();
    };
  }
}
