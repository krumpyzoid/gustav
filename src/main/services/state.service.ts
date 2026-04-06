import type { GitPort } from '../ports/git.port';
import type { TmuxPort } from '../ports/tmux.port';
import type { RegistryService } from './registry.service';
import type { AppState, SessionEntry, ClaudeStatus } from '../domain/types';

export class StateService {
  private prevPaneContent: Record<string, string> = {};
  private listener: ((state: AppState) => void) | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private git: GitPort,
    private tmux: TmuxPort,
    private registry: RegistryService,
  ) {}

  onChange(listener: (state: AppState) => void): void {
    this.listener = listener;
  }

  startPolling(intervalMs = 5000): void {
    this.timer = setInterval(async () => {
      const state = await this.collect();
      this.listener?.(state);
    }, intervalMs);
  }

  stopPolling(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async collect(): Promise<AppState> {
    const entries: SessionEntry[] = [];
    const repoSet = new Map<string, string>();

    // Load persisted repos from registry
    const registry = this.registry.load();
    for (const [name, rootPath] of Object.entries(registry)) {
      const { existsSync } = require('node:fs');
      if (existsSync(rootPath)) {
        repoSet.set(name, rootPath);
      }
    }

    // Discover repos from active tmux sessions
    const sessions = await this.tmux.listSessions();

    for (const trimmed of sessions) {
      if (trimmed.startsWith('_wt_')) continue;

      const slashIdx = trimmed.indexOf('/');
      if (slashIdx === -1) {
        entries.push({
          repo: 'standalone',
          branch: trimmed,
          tmuxSession: trimmed,
          status: 'none',
          worktreePath: null,
          isMainWorktree: false,
          upstream: null,
        });
      } else {
        const repo = trimmed.slice(0, slashIdx);
        const branch = trimmed.slice(slashIdx + 1);
        const status = await this.detectClaudeStatus(trimmed);
        entries.push({ repo, branch, tmuxSession: trimmed, status, worktreePath: null, isMainWorktree: false, upstream: null });
      }
    }

    // Find orphaned worktrees (including main worktree)
    const activeNames = new Set(entries.map((e) => e.tmuxSession));
    const upstreamsByRepo = new Map<string, Map<string, string>>();

    for (const [repoName, repoRoot] of repoSet) {
      try {
        const upstreams = await this.git.getUpstreams(repoRoot);
        upstreamsByRepo.set(repoName, upstreams);

        const wtDir = this.git.getWorktreeDir(repoRoot);
        const raw = await this.git.worktreeListPorcelain(repoRoot);
        let curPath = '';
        let curBranch: string | null = null;

        for (const line of (raw + '\n').split('\n')) {
          if (line.startsWith('worktree ')) {
            curPath = line.slice(9);
            curBranch = null;
          } else if (line.startsWith('branch refs/heads/')) {
            curBranch = line.slice(18);
          } else if (line === '' && curPath) {
            const isMain = curPath === repoRoot;
            const isUnderWtDir = curPath.startsWith(wtDir);
            if ((isUnderWtDir || isMain) && curBranch) {
              const sessionName = `${repoName}/${curBranch}`;
              if (!activeNames.has(sessionName)) {
                entries.push({
                  repo: repoName,
                  branch: curBranch,
                  tmuxSession: null,
                  status: 'none',
                  worktreePath: curPath,
                  isMainWorktree: isMain,
                  upstream: upstreams.get(curBranch) ?? null,
                });
              } else {
                const entry = entries.find((e) => e.tmuxSession === sessionName);
                if (entry) {
                  entry.worktreePath = curPath;
                  entry.isMainWorktree = isMain;
                  entry.upstream = upstreams.get(curBranch) ?? null;
                }
              }
            }
            curPath = '';
            curBranch = null;
          }
        }
      } catch {}
    }

    // Set upstream for tmux-only entries (no worktree match)
    for (const entry of entries) {
      if (entry.repo !== 'standalone' && entry.upstream === null) {
        const upstreams = upstreamsByRepo.get(entry.repo);
        if (upstreams) {
          entry.upstream = upstreams.get(entry.branch) ?? null;
        }
      }
    }

    return { entries, repos: [...repoSet.entries()] };
  }

  private async detectClaudeStatus(session: string): Promise<ClaudeStatus> {
    const panes = await this.tmux.listPanes(session);
    if (!panes) return 'none';

    let claudePaneId: string | null = null;
    for (const line of panes.split('\n')) {
      const [id, winName, cmd] = line.split('\t');
      if (winName === 'Claude Code' && cmd === 'claude') {
        claudePaneId = id;
        break;
      }
    }
    if (!claudePaneId) return 'none';

    const content = await this.tmux.capturePaneContent(claudePaneId);
    if (!content) return 'none';

    const lines = content.split('\n').filter((l) => l.trim().length > 0);
    const tail = lines.slice(-10);
    const tailStr = tail.join('\n');

    // Tool approval prompts = needs user input
    if (/\(y\s*=\s*yes|Allow|Approve|Do you want/.test(tailStr)) return 'action';

    // Spinner line
    for (const line of tail) {
      const t = line.trim();
      if (/^[✶·✢✻✹*]/.test(t)) {
        const parenMatch = t.match(/\(([^)]+)\)\s*$/);
        if (parenMatch) {
          const inside = parenMatch[1];
          if (/ing\b/.test(inside)) return 'busy';
          if (/for \d/.test(inside)) return 'done';
        }
      }
      if (/⎿\s+\S.*ing/.test(t)) return 'busy';
    }

    // Compare output area — if content changed since last poll, busy
    const outputArea = lines.slice(0, -6).join('\n');
    const prev = this.prevPaneContent[claudePaneId];
    this.prevPaneContent[claudePaneId] = outputArea;

    if (prev !== undefined && prev !== outputArea) return 'busy';

    return 'done';
  }
}
