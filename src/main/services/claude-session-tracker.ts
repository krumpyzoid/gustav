import { join } from 'node:path';
import { homedir } from 'node:os';
import type { TmuxPort } from '../ports/tmux.port';
import type { ShellPort } from '../ports/shell.port';
import type { FileSystemPort } from '../ports/filesystem.port';
import type { WorkspaceService } from './workspace.service';
import type { Workspace, PersistedSession, WindowSpec } from '../domain/types';
import { normalizeWindows } from '../domain/types';

export class ClaudeSessionTracker {
  constructor(
    private tmux: TmuxPort,
    private shell: ShellPort,
    private fs: FileSystemPort,
    private workspaceService: WorkspaceService,
  ) {}

  /**
   * Scan all persisted sessions for Claude processes and capture their session IDs.
   * Returns true if any WindowSpec was updated.
   */
  async captureAll(workspaces: Workspace[]): Promise<boolean> {
    let anyChanged = false;

    for (const ws of workspaces) {
      for (const session of ws.sessions ?? []) {
        try {
          const changed = await this.captureForSession(ws.id, session);
          if (changed) anyChanged = true;
        } catch {
          // Session may not exist in tmux — skip silently
        }
      }
    }

    return anyChanged;
  }

  private async captureForSession(workspaceId: string, session: PersistedSession): Promise<boolean> {
    const panes = await this.tmux.listPanesExtended(session.tmuxSession);
    const specs = normalizeWindows(session.windows);
    let changed = false;

    for (const pane of panes) {
      if (pane.paneCommand !== 'claude') continue;

      const spec = specs.find((s) => s.name === pane.windowName);
      if (!spec) continue;

      const sessionId = await this.resolveClaudeSessionId(pane.panePid);
      if (!sessionId) continue;

      if (spec.claudeSessionId !== sessionId) {
        spec.claudeSessionId = sessionId;
        changed = true;
      }

      if (spec.command !== 'claude') {
        spec.command = 'claude';
        changed = true;
      }
    }

    if (changed) {
      // Cast is safe: we've normalized windows to WindowSpec[] but the persisted
      // type accepts (string | WindowSpec)[] for backward compatibility.
      await this.workspaceService.persistSession(workspaceId, {
        ...session,
        windows: specs,
      } as PersistedSession);
    }

    return changed;
  }

  private async resolveClaudeSessionId(shellPid: number): Promise<string | null> {
    let childPids: number[];
    try {
      const output = await this.shell.exec(`pgrep -P ${shellPid}`);
      childPids = output
        .split('\n')
        .filter(Boolean)
        .map(Number)
        .filter((n) => !isNaN(n));
    } catch {
      // pgrep exits non-zero when no children are found — not an error condition
      return null;
    }

    const claudeSessionsDir = join(homedir(), '.claude', 'sessions');

    for (const pid of childPids) {
      try {
        const content = await this.fs.readFile(join(claudeSessionsDir, `${pid}.json`));
        const data = JSON.parse(content) as { sessionId?: string };
        if (data.sessionId) return data.sessionId;
      } catch {
        // No session file for this PID — try the next child
        continue;
      }
    }

    return null;
  }
}
