import { basename } from 'node:path';
import type { TmuxPort } from '../ports/tmux.port';
import type { GustavConfig, PersistedSession, Workspace, WindowSpec } from '../domain/types';
import { normalizeWindows } from '../domain/types';

/** Determine the command to send when restoring a tmux window.
 * Claude windows use --resume when a prior session ID is tracked, falling back
 * to --continue. All other windows pass their command through unchanged. */
export function buildRestoreCommand(spec: WindowSpec): string | undefined {
  if (!spec.command) return undefined;
  if (spec.command === 'claude' && spec.claudeSessionId) {
    return `claude --resume ${spec.claudeSessionId}`;
  }
  if (spec.command === 'claude') {
    return 'claude --continue';
  }
  return spec.command;
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

  /** Workspace session: claude + shell + .gustav custom windows. No Git window. */
  async launchWorkspaceSession(
    workspaceName: string,
    workspaceDir: string,
    config: GustavConfig,
    label?: string,
    claudeSessionId?: string,
  ): Promise<string> {
    const session = this.getSessionName(workspaceName, { type: 'workspace', label });
    if (await this.tmux.hasSession(session)) {
      throw new Error(`Session "${label ?? '_ws'}" already exists in workspace "${workspaceName}"`);
    }

    const claudeCmd = claudeSessionId ? `claude --resume ${claudeSessionId}` : 'claude';
    await this.createBaseSession(session, workspaceDir);
    await this.tmux.sendKeys(`${session}:Claude Code`, claudeCmd);
    await this.tmux.newWindow(session, 'Shell', workspaceDir);
    await this.addCustomWindows(session, workspaceDir, config);
    await this.tmux.selectWindow(session, 'Claude Code');

    return session;
  }

  /** Directory session (repo root): claude + git + shell + .gustav custom windows. */
  async launchDirectorySession(
    workspaceName: string,
    repoRoot: string,
    config: GustavConfig,
    claudeSessionId?: string,
  ): Promise<string> {
    const repoName = basename(repoRoot);
    const session = this.getSessionName(workspaceName, { type: 'directory', repoName });
    if (await this.tmux.hasSession(session)) return session;

    const claudeCmd = claudeSessionId ? `claude --resume ${claudeSessionId}` : 'claude';
    await this.createBaseSession(session, repoRoot);
    await this.tmux.sendKeys(`${session}:Claude Code`, claudeCmd);
    await this.tmux.newWindow(session, 'Git', repoRoot);
    await this.tmux.sendKeys(`${session}:Git`, 'lazygit');
    await this.tmux.newWindow(session, 'Shell', repoRoot);
    await this.addCustomWindows(session, repoRoot, config);
    await this.tmux.selectWindow(session, 'Claude Code');

    return session;
  }

  /** Worktree session: same layout as directory session, in worktree path. */
  async launchWorktreeSession(
    workspaceName: string,
    repoRoot: string,
    branch: string,
    workdir: string,
    config: GustavConfig,
    claudeSessionId?: string,
  ): Promise<string> {
    const repoName = basename(repoRoot);
    const session = this.getSessionName(workspaceName, { type: 'worktree', repoName, branch });
    if (await this.tmux.hasSession(session)) return session;

    const claudeCmd = claudeSessionId ? `claude --resume ${claudeSessionId}` : 'claude';
    await this.createBaseSession(session, workdir);
    await this.tmux.sendKeys(`${session}:Claude Code`, claudeCmd);
    await this.tmux.newWindow(session, 'Git', workdir);
    await this.tmux.sendKeys(`${session}:Git`, 'lazygit');
    await this.tmux.newWindow(session, 'Shell', workdir);
    await this.addCustomWindows(session, workdir, config);
    await this.tmux.selectWindow(session, 'Claude Code');

    return session;
  }

  /** Standalone session: claude + shell only, no config. */
  async launchStandaloneSession(label: string, dir: string, claudeSessionId?: string): Promise<string> {
    const session = this.getSessionName(null, { type: 'workspace', label });
    if (await this.tmux.hasSession(session)) return session;

    const claudeCmd = claudeSessionId ? `claude --resume ${claudeSessionId}` : 'claude';
    await this.createBaseSession(session, dir);
    await this.tmux.sendKeys(`${session}:Claude Code`, claudeCmd);
    await this.tmux.newWindow(session, 'Shell', dir);
    await this.tmux.selectWindow(session, 'Claude Code');

    return session;
  }

  /** Restore a persisted session that is missing from tmux. */
  async restoreSession(session: PersistedSession): Promise<void> {
    if (await this.tmux.hasSession(session.tmuxSession)) return;

    const [first, ...rest] = normalizeWindows(session.windows);
    if (!first) return;

    const defaultDir = session.directory;
    await this.tmux.newSession(session.tmuxSession, { windowName: first.name, cwd: first.directory ?? defaultDir });
    await this.tmux.exec(`set-option -t '${session.tmuxSession}' status off`);
    await this.tmux.exec(`set-option -t '${session.tmuxSession}' prefix None`);
    await this.tmux.exec(`set-option -t '${session.tmuxSession}' mouse on`);

    const firstCmd = buildRestoreCommand(first);
    if (firstCmd) await this.tmux.sendKeys(`${session.tmuxSession}:${first.name}`, firstCmd);

    for (const spec of rest) {
      await this.tmux.newWindow(session.tmuxSession, spec.name, spec.directory ?? defaultDir);
      const cmd = buildRestoreCommand(spec);
      if (cmd) await this.tmux.sendKeys(`${session.tmuxSession}:${spec.name}`, cmd);
    }

    await this.tmux.selectWindow(session.tmuxSession, first.name);
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

  // ── Legacy support (used by worktree.service until it's updated) ──
  /** @deprecated Use getSessionName with opts instead */
  getLegacySessionName(repoRoot: string, branch: string, isMainWorktree = false): string {
    const repo = basename(repoRoot);
    return isMainWorktree ? `${repo}/_dir` : `${repo}/${branch}`;
  }

  /** @deprecated Use type-specific launch methods instead */
  async launch(
    repoRoot: string,
    branch: string,
    workdir: string,
    config: GustavConfig,
  ): Promise<string> {
    const session = this.getLegacySessionName(repoRoot, branch);
    if (await this.tmux.hasSession(session)) return session;

    await this.createBaseSession(session, workdir);
    await this.tmux.sendKeys(`${session}:Claude Code`, 'claude');
    await this.tmux.newWindow(session, 'Git', workdir);
    await this.tmux.sendKeys(`${session}:Git`, 'lazygit');
    await this.tmux.newWindow(session, 'Shell', workdir);
    await this.addCustomWindows(session, workdir, config);
    await this.tmux.selectWindow(session, 'Claude Code');

    return session;
  }

  /** @deprecated Use kill(session) instead */
  async killLegacy(repoRoot: string, branch: string, isMainWorktree = false): Promise<void> {
    const session = this.getLegacySessionName(repoRoot, branch, isMainWorktree);
    await this.kill(session);
  }

  // ── Private ──

  private async createBaseSession(session: string, cwd: string): Promise<void> {
    await this.tmux.newSession(session, { windowName: 'Claude Code', cwd });
    await this.tmux.exec(`set-option -t '${session}' status off`);
    await this.tmux.exec(`set-option -t '${session}' prefix None`);
    await this.tmux.exec(`set-option -t '${session}' mouse on`);
  }

  private async addCustomWindows(
    session: string,
    cwd: string,
    config: GustavConfig,
  ): Promise<void> {
    for (const entry of config.tmux) {
      const colonIdx = entry.indexOf(':');
      const name = colonIdx > -1 ? entry.slice(0, colonIdx) : entry;
      const cmd = colonIdx > -1 ? entry.slice(colonIdx + 1) : '';

      await this.tmux.newWindow(session, name, cwd);
      if (cmd) {
        await this.tmux.sendKeys(`${session}:${name}`, cmd);
      }
    }
  }
}
