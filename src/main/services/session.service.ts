import { basename } from 'node:path';
import type { TmuxPort } from '../ports/tmux.port';
import type { WtConfig } from '../domain/types';

export class SessionService {
  constructor(private tmux: TmuxPort) {}

  getSessionName(repoRoot: string, branch: string, isMainWorktree = false): string {
    const repo = basename(repoRoot);
    return isMainWorktree ? `${repo}/$dir` : `${repo}/${branch}`;
  }

  async launch(
    repoRoot: string,
    branch: string,
    workdir: string,
    config: WtConfig,
  ): Promise<string> {
    const session = this.getSessionName(repoRoot, branch);

    if (await this.tmux.hasSession(session)) {
      return session;
    }

    // Create session with Claude Code window
    await this.tmux.newSession(session, { windowName: 'Claude Code', cwd: workdir });
    await this.tmux.sendKeys(`${session}:Claude Code`, 'claude');

    // Default windows
    await this.tmux.newWindow(session, 'Git', workdir);
    await this.tmux.sendKeys(`${session}:Git`, 'lazygit');

    await this.tmux.newWindow(session, 'Shell', workdir);

    // Custom windows from .wt [tmux] config
    for (const entry of config.tmux) {
      const colonIdx = entry.indexOf(':');
      const name = colonIdx > -1 ? entry.slice(0, colonIdx) : entry;
      const cmd = colonIdx > -1 ? entry.slice(colonIdx + 1) : '';

      await this.tmux.newWindow(session, name, workdir);
      if (cmd) {
        await this.tmux.sendKeys(`${session}:${name}`, cmd);
      }
    }

    // Select first window
    await this.tmux.selectWindow(session, 'Claude Code');

    return session;
  }

  async kill(repoRoot: string, branch: string, isMainWorktree = false): Promise<void> {
    const session = this.getSessionName(repoRoot, branch, isMainWorktree);
    if (await this.tmux.hasSession(session)) {
      await this.tmux.killSession(session);
    }
  }

  async switchTo(session: string, tty: string): Promise<void> {
    await this.tmux.switchClient(tty, session);
  }
}
