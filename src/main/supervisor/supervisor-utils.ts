import type { SessionSupervisorPort } from './supervisor.port';
import type { WindowInfo } from '../domain/types';

/**
 * Build a `WindowInfo[]` from a supervisor's window list for renderer
 * compatibility. The supervisor uses string ids; we synthesize numeric
 * indices to match the renderer's `WindowInfo.index` field. Used by both
 * the local IPC handlers and the remote command dispatcher so they don't
 * drift apart.
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
