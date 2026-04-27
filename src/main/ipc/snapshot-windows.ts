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
 *
 * Output order: persisted order wins over tmux index order — entries in
 * `existingWindows` are emitted first (in their order, dropping any that no
 * longer live in tmux), then any new tmux windows are appended.
 */
export async function snapshotSessionWindows(
  tmux: TmuxPort,
  session: string,
  existingWindows: WindowSpec[],
  shell?: ShellPort,
): Promise<WindowSpec[]> {
  const liveWindows = await tmux.listWindows(session);
  const panes = await tmux.listPanesExtended(session);

  const liveByName = new Map<string, { index: number; name: string; active: boolean }>();
  for (const win of liveWindows) liveByName.set(win.name, win);

  const paneByWindow = new Map<string, { command: string; pid: number; cwd: string }>();
  for (const pane of panes) {
    if (!paneByWindow.has(pane.windowName)) {
      paneByWindow.set(pane.windowName, { command: pane.paneCommand, pid: pane.panePid, cwd: pane.paneCwd });
    }
  }

  async function buildSpec(name: string, existing: WindowSpec | undefined): Promise<WindowSpec> {
    const pane = paneByWindow.get(name);
    const directory = pane?.cwd || undefined;

    if (existing?.kind === 'claude') {
      // Preserve claude tab as-is — user-supplied args + tracked session id own continuity.
      return {
        name,
        kind: 'claude',
        ...(existing.args ? { args: existing.args } : {}),
        ...(existing.claudeSessionId ? { claudeSessionId: existing.claudeSessionId } : {}),
        ...(directory ? { directory } : {}),
      };
    }

    if (pane && shell) {
      const childCmd = await resolveChildCommand(shell, pane.pid);
      const inferred = inferKindFromCommand(childCmd, pane.command);
      return {
        name,
        ...inferred,
        ...(existing?.claudeSessionId && inferred.kind === 'claude'
          ? { claudeSessionId: existing.claudeSessionId }
          : {}),
        ...(directory ? { directory } : {}),
      };
    }

    if (pane) {
      const inferred = inferKindFromCommand(null, pane.command);
      return {
        name,
        ...inferred,
        ...(directory ? { directory } : {}),
      };
    }

    return {
      name,
      kind: 'command',
      ...(directory ? { directory } : {}),
    };
  }

  const merged: WindowSpec[] = [];
  const seen = new Set<string>();

  // First pass: persisted order wins. Drop any persisted entries no longer in tmux.
  for (const existing of existingWindows) {
    if (!liveByName.has(existing.name)) continue;
    seen.add(existing.name);
    merged.push(await buildSpec(existing.name, existing));
  }

  // Second pass: append any tmux windows we haven't already emitted.
  for (const win of liveWindows) {
    if (seen.has(win.name)) continue;
    merged.push(await buildSpec(win.name, undefined));
  }

  return merged;
}
