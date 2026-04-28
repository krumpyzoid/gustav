import type { SessionService } from './session.service';
import type { PreferenceService } from './preference.service';
import type { SessionSupervisorPort } from '../supervisor/supervisor.port';
import type { SessionBackend, WindowSpec } from '../domain/types';

/**
 * Phase 3 strangler dispatcher.
 *
 * Reads `Preferences.sessionSupervisor` and routes new-session creation to
 * either the tmux-backed `SessionService` or the in-process `NativeSupervisor`.
 * Existing sessions are not touched — the IPC handlers look up the per-session
 * backend from persisted state and dispatch sleep/wake/destroy/window-ops to
 * whichever backend originally created them.
 *
 * The launcher's only job is to pick the backend at *creation* time and tell
 * the caller which one was used so the persisted entry can record it.
 */
export class SessionLauncherService {
  constructor(
    private sessionService: SessionService,
    private supervisor: SessionSupervisorPort,
    private preferenceService: PreferenceService,
  ) {}

  /**
   * Spawn a session via the configured backend. Returns the session id and
   * which backend owns it; callers should persist `{ ...session, backend }`
   * so that subsequent operations can be dispatched correctly.
   */
  async launch(
    sessionId: string,
    cwd: string,
    windows: WindowSpec[],
  ): Promise<{ sessionId: string; backend: SessionBackend }> {
    const backend = this.preferenceService.load().sessionSupervisor ?? 'tmux';
    if (backend === 'native') {
      await this.supervisor.createSession({ sessionId, cwd, windows });
      return { sessionId, backend: 'native' };
    }
    const id = await this.sessionService.launchSession(sessionId, cwd, windows);
    return { sessionId: id, backend: 'tmux' };
  }
}
