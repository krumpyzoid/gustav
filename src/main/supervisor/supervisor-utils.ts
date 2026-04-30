import type { SessionSupervisorPort } from './supervisor.port';
import type { WindowInfo } from '../domain/types';

/**
 * Build a `WindowInfo[]` from a supervisor's window list for renderer
 * compatibility. The supervisor uses string ids; we synthesize numeric
 * indices to match the renderer's `WindowInfo.index` field. Used by both
 * the local IPC handlers and the remote command dispatcher so they don't
 * drift apart.
 *
 * NOTE: `active` is always `false`. The renderer determines the active
 * window from the persisted window order (the user's saved order), not
 * from the supervisor's `activeWindowId`. Callers that need the active
 * window highlighted must overlay it themselves — this helper is purely
 * a name+index synthesis.
 */
export function supervisorWindowsAsInfo(
  supervisor: SessionSupervisorPort,
  sessionId: string,
): WindowInfo[] {
  return supervisor.listWindows(sessionId).map((w, index) => ({
    index,
    name: w.name,
    active: false,
  }));
}
