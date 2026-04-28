import type { TmuxPort } from '../ports/tmux.port';
import type { PersistedSession, Workspace, WindowSpec } from '../domain/types';
import { composeClaudeCommand } from '../domain/claude-command';

/** Determine the command to send when restoring a tmux window.
 * Claude tabs delegate to composeClaudeCommand so flags and the tracked
 * --resume id compose consistently. Other tabs pass their command through;
 * an absent command means "open an empty shell at cwd". */
export function buildRestoreCommand(spec: WindowSpec): string | undefined {
  if (spec.kind === 'claude') {
    return composeClaudeCommand({ args: spec.args, claudeSessionId: spec.claudeSessionId });
  }
  return spec.command || undefined;
}

export type SessionNameOpts =
  | { type: 'workspace'; label?: string }
  | { type: 'directory'; repoName: string }
  | { type: 'worktree'; repoName: string; branch: string };

export class SessionService {
  constructor(private tmux: TmuxPort) {}

  /** Build the tmux session name for any session type. */
  getSessionName(workspaceName: string | null, opts: SessionNameOpts): string {
    const prefix = workspaceName ?? '_standalone';

    switch (opts.type) {
      case 'workspace':
        if (!workspaceName) return `${prefix}/${opts.label ?? 'session'}`;
        return opts.label ? `${prefix}/${opts.label}` : `${prefix}/_ws`;
      case 'directory':
        return `${prefix}/${opts.repoName}/_dir`;
      case 'worktree':
        return `${prefix}/${opts.repoName}/${opts.branch}`;
    }
  }

  /** Generic launch — creates a tmux session and populates it from `windows`.
   * The first window is the initial window (created with `newSession`); the
   * rest are appended via `newWindow`. Each spec's command is composed via
   * `buildRestoreCommand` so claude tabs honor args + tracked sessionId. */
  async launchSession(
    sessionName: string,
    cwd: string,
    windows: WindowSpec[],
  ): Promise<string> {
    if (await this.tmux.hasSession(sessionName)) return sessionName;
    if (windows.length === 0) {
      throw new Error(`Cannot launch session "${sessionName}" with no windows`);
    }

    const [first, ...rest] = windows;
    await this.createBaseSession(sessionName, first.directory ?? cwd, first.name);

    const firstCmd = buildRestoreCommand(first);
    if (firstCmd) await this.tmux.sendKeys(`${sessionName}:${first.name}`, firstCmd);

    for (const spec of rest) {
      await this.tmux.newWindow(sessionName, spec.name, spec.directory ?? cwd);
      const cmd = buildRestoreCommand(spec);
      if (cmd) await this.tmux.sendKeys(`${sessionName}:${spec.name}`, cmd);
    }

    await this.tmux.selectWindow(sessionName, first.name);
    return sessionName;
  }

  /** Restore a persisted session that is missing from tmux. */
  async restoreSession(session: PersistedSession): Promise<void> {
    if (session.windows.length === 0) return;
    await this.launchSession(session.tmuxSession, session.directory, session.windows);
  }

  /** Restore all persisted sessions from all workspaces. */
  async restoreAll(workspaces: Workspace[]): Promise<void> {
    for (const ws of workspaces) {
      for (const session of ws.sessions ?? []) {
        await this.restoreSession(session);
      }
    }
  }

  async kill(session: string): Promise<void> {
    if (await this.tmux.hasSession(session)) {
      await this.tmux.killSession(session);
    }
  }

  async switchTo(session: string, tty: string): Promise<void> {
    await this.tmux.switchClient(tty, session);
  }

  // ── Private ──

  private async createBaseSession(session: string, cwd: string, windowName: string): Promise<void> {
    await this.tmux.newSession(session, { windowName, cwd });
    await this.tmux.exec(`set-option -t '${session}' status off`);
    await this.tmux.exec(`set-option -t '${session}' prefix None`);
    await this.tmux.exec(`set-option -t '${session}' mouse on`);
    // Resize policy: latest-active client drives the PTY size, not the largest
    // attached client. Without this, an idle laptop attached at 80x24 forces the
    // active desktop's 200x60 window to that size on every redraw.
    await this.tmux.exec(`set-option -t '${session}' window-size latest`);
  }
}
