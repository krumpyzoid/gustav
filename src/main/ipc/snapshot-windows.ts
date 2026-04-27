import type { TmuxPort } from '../ports/tmux.port';
import type { ShellPort } from '../ports/shell.port';
import type { WindowSpec } from '../domain/types';
import { stripResumeContinueFlags } from '../domain/claude-command';

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
    const childPid = childPids.split('\n')[0];
    const raw = (await shell.exec(`ps -p ${childPid} -o args=`)).trim();
    if (!raw) return null;
    // Strip absolute path from the first word: /usr/local/bin/npm → npm
    return raw.replace(/^\/\S*\//, '');
  } catch {
    return null;
  }
}

type InferredFields = Pick<WindowSpec, 'kind' | 'command' | 'args'>;

/**
 * Infer kind/command/args from the resolved child command and the pane's
 * foreground process name. Used for windows that have no preserved kind
 * (legacy specs or freshly-discovered windows).
 */
function inferKindFromCommand(childCmd: string | null, paneCommand: string): InferredFields {
  if (childCmd) {
    const tokens = childCmd.trim().split(/\s+/);
    if (tokens[0] === 'claude') {
      const args = stripResumeContinueFlags(tokens.slice(1).join(' '));
      return args ? { kind: 'claude', args } : { kind: 'claude' };
    }
    return { kind: 'command', command: childCmd };
  }
  if (paneCommand === 'claude') {
    return { kind: 'claude' };
  }
  if (!SHELLS.has(paneCommand)) {
    return { kind: 'command', command: paneCommand };
  }
  return { kind: 'command' };
}

/**
 * Snapshot the current window state of a tmux session, merging live pane info
 * with existing persisted specs. Claude tabs preserve their kind/args/session-id;
 * other tabs re-resolve their command from the running process.
 */
export async function snapshotSessionWindows(
  tmux: TmuxPort,
  session: string,
  existingWindows: WindowSpec[],
  shell?: ShellPort,
): Promise<WindowSpec[]> {
  const existingSpecs = existingWindows;
  const liveWindows = await tmux.listWindows(session);
  const panes = await tmux.listPanesExtended(session);

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

    if (existing?.kind === 'claude') {
      // Preserve claude tab as-is — user-supplied args + tracked session id own continuity.
      merged.push({
        name: win.name,
        kind: 'claude',
        ...(existing.args ? { args: existing.args } : {}),
        ...(existing.claudeSessionId ? { claudeSessionId: existing.claudeSessionId } : {}),
        ...(directory ? { directory } : {}),
      });
      continue;
    }

    if (pane && shell) {
      const childCmd = await resolveChildCommand(shell, pane.pid);
      const inferred = inferKindFromCommand(childCmd, pane.command);
      merged.push({
        name: win.name,
        ...inferred,
        ...(existing?.claudeSessionId && inferred.kind === 'claude'
          ? { claudeSessionId: existing.claudeSessionId }
          : {}),
        ...(directory ? { directory } : {}),
      });
      continue;
    }

    if (pane) {
      const inferred = inferKindFromCommand(null, pane.command);
      merged.push({
        name: win.name,
        ...inferred,
        ...(directory ? { directory } : {}),
      });
      continue;
    }

    merged.push({
      name: win.name,
      kind: 'command',
      ...(directory ? { directory } : {}),
    });
  }

  return merged;
}
