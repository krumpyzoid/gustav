import type { TmuxPort } from '../ports/tmux.port';
import type { ShellPort } from '../ports/shell.port';
import type { WindowSpec } from '../domain/types';
import { normalizeWindows } from '../domain/types';

const SHELLS = new Set(['zsh', 'fish', 'bash', 'sh', 'tcsh', 'csh', 'ksh', 'dash', 'login']);

/**
 * Get the full command line of the foreground process in a tmux pane.
 * The pane PID is the shell; we find its direct child and read its args.
 * Returns null if the shell has no child (user is at a prompt).
 */
async function resolveChildCommand(shell: ShellPort, panePid: number): Promise<string | null> {
  try {
    const childPids = (await shell.exec(`pgrep -P ${panePid}`)).trim();
    if (!childPids) return null;
    // Take the first child (foreground process)
    const childPid = childPids.split('\n')[0];
    const raw = (await shell.exec(`ps -p ${childPid} -o args=`)).trim();
    if (!raw) return null;
    // Strip absolute path from the first word: /usr/local/bin/npm → npm
    return raw.replace(/^\/\S*\//, '');
  } catch {
    return null;
  }
}

/**
 * Snapshot the current window state of a tmux session, merging live pane info
 * with existing persisted specs. Existing commands and claudeSessionIds are
 * preserved; new/bare windows get their running command resolved from the
 * shell's child process (full command line, not just the process name).
 * Per-window working directories are also captured.
 */
export async function snapshotSessionWindows(
  tmux: TmuxPort,
  session: string,
  existingWindows: (string | WindowSpec)[],
  shell?: ShellPort,
): Promise<WindowSpec[]> {
  const existingSpecs = normalizeWindows(existingWindows);
  const liveWindows = await tmux.listWindows(session);
  const panes = await tmux.listPanesExtended(session);

  // Build a map of windowName → first pane info
  const paneByWindow = new Map<string, { command: string; pid: number; cwd: string }>();
  for (const pane of panes) {
    if (!paneByWindow.has(pane.windowName)) {
      paneByWindow.set(pane.windowName, { command: pane.paneCommand, pid: pane.panePid, cwd: pane.paneCwd });
    }
  }

  const merged: WindowSpec[] = [];

  for (const win of liveWindows) {
    const existing = existingSpecs.find((s) => s.name === win.name);
    const pane = paneByWindow.get(win.name);
    const directory = pane?.cwd || undefined;

    if (existing?.command === 'claude') {
      // Claude windows have special restore logic (--resume/--continue) — preserve as-is
      merged.push({ ...existing, ...(directory ? { directory } : {}) });
    } else if (pane && shell) {
      // Resolve command from the shell's child process for the full command line
      // (pane_current_command only gives the process name, e.g. 'node' for 'pnpm run dev')
      const childCmd = await resolveChildCommand(shell, pane.pid);
      merged.push({
        name: win.name,
        ...(childCmd ? { command: childCmd } : {}),
        ...(existing?.claudeSessionId ? { claudeSessionId: existing.claudeSessionId } : {}),
        ...(directory ? { directory } : {}),
      });
    } else if (pane && !SHELLS.has(pane.command)) {
      // No shell port — fall back to process name for non-shell processes
      merged.push({
        name: win.name,
        command: pane.command,
        ...(existing?.claudeSessionId ? { claudeSessionId: existing.claudeSessionId } : {}),
        ...(directory ? { directory } : {}),
      });
    } else {
      // No pane info or shell at prompt without shell port
      merged.push({
        name: win.name,
        ...(existing?.claudeSessionId ? { claudeSessionId: existing.claudeSessionId } : {}),
        ...(directory ? { directory } : {}),
      });
    }
  }

  return merged;
}
