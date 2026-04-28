import { join } from 'node:path';
import { homedir } from 'node:os';
import type { TmuxPort } from '../ports/tmux.port';
import type { ShellPort } from '../ports/shell.port';
import type { FileSystemPort } from '../ports/filesystem.port';
import type { AssistantLogPort } from '../ports/assistant-log.port';
import type { WorkspaceService } from './workspace.service';
import type { Workspace, PersistedSession, WindowSpec } from '../domain/types';

export class ClaudeSessionTracker {
  private trackedSessionIds = new Set<string>();

  constructor(
    private tmux: TmuxPort,
    private shell: ShellPort,
    private fs: FileSystemPort,
    private workspaceService: WorkspaceService,
    private assistantLog?: AssistantLogPort,
  ) {}

  /**
   * Scan all persisted sessions for Claude processes and capture their session IDs.
   * Returns true if any WindowSpec was updated.
   */
  async captureAll(workspaces: Workspace[]): Promise<boolean> {
    let anyChanged = false;
    const liveSessionIds = new Set<string>();

    for (const ws of workspaces) {
      for (const session of ws.sessions ?? []) {
        for (const win of session.windows ?? []) {
          if (win.kind === 'claude' && win.claudeSessionId) {
            liveSessionIds.add(win.claudeSessionId);
            this.ensureTracked(win.claudeSessionId, session.directory);
          }
        }
        try {
          const changed = await this.captureForSession(ws.id, session);
          if (changed) anyChanged = true;
        } catch {
          // Session may not exist in tmux — skip silently
        }
      }
    }

    // Untrack sessions that have disappeared from persisted state.
    for (const id of [...this.trackedSessionIds]) {
      if (!liveSessionIds.has(id)) {
        this.assistantLog?.untrack(id);
        this.trackedSessionIds.delete(id);
      }
    }

    return anyChanged;
  }

  private ensureTracked(sessionId: string, cwd: string): void {
    if (!this.assistantLog) return;
    if (this.trackedSessionIds.has(sessionId)) return;
    this.assistantLog.track(sessionId, cwd);
    this.trackedSessionIds.add(sessionId);
  }

  private async captureForSession(workspaceId: string, session: PersistedSession): Promise<boolean> {
    const panes = await this.tmux.listPanesExtended(session.tmuxSession);
    const specs = [...session.windows];
    let changed = false;

    for (const pane of panes) {
      if (pane.paneCommand !== 'claude') continue;

      const idx = specs.findIndex((s) => s.name === pane.windowName);
      if (idx === -1) continue;
      const spec = specs[idx];

      const sessionId = await this.resolveClaudeSessionId(pane.panePid);
      if (!sessionId) continue;

      if (spec.claudeSessionId !== sessionId || spec.kind !== 'claude') {
        specs[idx] = { ...spec, kind: 'claude', claudeSessionId: sessionId };
        changed = true;
      }

      this.ensureTracked(sessionId, pane.paneCwd || session.directory);
    }

    if (changed) {
      await this.workspaceService.persistSession(workspaceId, {
        ...session,
        windows: specs,
      });
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
