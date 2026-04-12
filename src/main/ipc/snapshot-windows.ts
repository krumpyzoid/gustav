import type { TmuxPort, PaneInfo } from '../ports/tmux.port';
import type { WindowSpec } from '../domain/types';
import { normalizeWindows } from '../domain/types';

const SHELLS = new Set(['zsh', 'fish', 'bash', 'sh', 'tcsh', 'csh', 'ksh', 'dash', 'login']);

/**
 * Snapshot the current window state of a tmux session, merging live pane info
 * with existing persisted specs. Existing commands and claudeSessionIds are
 * preserved; new/bare windows get their running command captured from tmux
 * (unless it's just a shell prompt).
 */
export async function snapshotSessionWindows(
  tmux: TmuxPort,
  session: string,
  existingWindows: (string | WindowSpec)[],
): Promise<WindowSpec[]> {
  const existingSpecs = normalizeWindows(existingWindows);
  const liveWindows = await tmux.listWindows(session);
  const panes = await tmux.listPanesExtended(session);

  // Build a map of windowName → first pane's command
  const paneCommandByWindow = new Map<string, string>();
  for (const pane of panes) {
    if (!paneCommandByWindow.has(pane.windowName)) {
      paneCommandByWindow.set(pane.windowName, pane.paneCommand);
    }
  }

  const merged: WindowSpec[] = [];

  for (const win of liveWindows) {
    const existing = existingSpecs.find((s) => s.name === win.name);
    const paneCmd = paneCommandByWindow.get(win.name);

    if (existing?.command) {
      // Existing spec has a known command — keep it (authoritative)
      merged.push(existing);
    } else {
      // No known command — capture from live pane if not just a shell
      const command = paneCmd && !SHELLS.has(paneCmd) ? paneCmd : undefined;
      merged.push({
        name: win.name,
        ...(command ? { command } : {}),
        ...(existing?.claudeSessionId ? { claudeSessionId: existing.claudeSessionId } : {}),
      });
    }
  }

  return merged;
}
