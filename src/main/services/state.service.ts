import type { GitPort } from '../ports/git.port';
import type { TmuxPort } from '../ports/tmux.port';
import type { RegistryService } from './registry.service';
import type { AppState, SessionEntry, ClaudeStatus } from '../domain/types';

export type RawStatus = 'busy' | 'action' | null;

export function parseRawStatus(content: string): RawStatus {
  if (!content || !content.trim()) return null;

  const lines = content.split('\n').filter((l) => l.trim().length > 0);

  // Busy: spinner symbol at line start + ing… — only check content above ─── chrome
  const sepIdx = lines.findIndex((l) => /^─+$/.test(l.trim()));
  const contentLines = sepIdx >= 0 ? lines.slice(0, sepIdx) : lines;
  if (contentLines.slice(-30).some((l) => /^\S\s.*ing…/.test(l))) return 'busy';

  // Action: check full tail (chrome included) — approval prompts may be anywhere
  const fullTail = lines.slice(-10).join('\n');
  if (/\(y\s*=\s*yes|Allow|Approve|Do you want/.test(fullTail)) return 'action';

  return null;
}

export class StateService {
  private dirtySessions = new Set<string>();
  private listener: ((state: AppState) => void) | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private polling = false;

  constructor(
    private git: GitPort,
    private tmux: TmuxPort,
    private registry: RegistryService,
  ) {}

  onChange(listener: (state: AppState) => void): void {
    this.listener = listener;
  }

  startPolling(intervalMs = 5000, getActiveSession?: () => string | null): void {
    this.timer = setInterval(async () => {
      if (this.polling) return;
      this.polling = true;
      try {
        const state = await this.collect(getActiveSession?.() ?? undefined);
        this.listener?.(state);
      } finally {
        this.polling = false;
      }
    }, intervalMs);
  }

  stopPolling(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async collect(activeSession?: string): Promise<AppState> {
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

    const sessionPromises = sessions
      .filter((s) => !s.startsWith('_wt_'))
      .map(async (trimmed): Promise<SessionEntry> => {
        const slashIdx = trimmed.indexOf('/');
        if (slashIdx === -1) {
          return { repo: 'standalone', branch: trimmed, tmuxSession: trimmed, status: 'none', worktreePath: null, isMainWorktree: false, upstream: null };
        }
        const repo = trimmed.slice(0, slashIdx);
        const branch = trimmed.slice(slashIdx + 1);
        const isDir = branch === '$dir';
        const status = await this.detectClaudeStatus(trimmed);
        return { repo, branch: isDir ? '' : branch, tmuxSession: trimmed, status, worktreePath: null, isMainWorktree: isDir, upstream: null };
      });

    entries.push(...await Promise.all(sessionPromises));

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
              // $dir sessions match main worktree; branch sessions match by name
              const dirSessionName = `${repoName}/$dir`;
              const branchSessionName = `${repoName}/${curBranch}`;

              if (isMain && activeNames.has(dirSessionName)) {
                // Main worktree with active $dir session — resolve branch dynamically
                const entry = entries.find((e) => e.tmuxSession === dirSessionName);
                if (entry) {
                  entry.branch = curBranch;
                  entry.worktreePath = curPath;
                  entry.upstream = upstreams.get(curBranch) ?? null;
                }
              } else if (activeNames.has(branchSessionName)) {
                const entry = entries.find((e) => e.tmuxSession === branchSessionName);
                if (entry) {
                  entry.worktreePath = curPath;
                  entry.isMainWorktree = isMain;
                  entry.upstream = upstreams.get(curBranch) ?? null;
                }
              } else {
                entries.push({
                  repo: repoName,
                  branch: curBranch,
                  tmuxSession: null,
                  status: 'none',
                  worktreePath: curPath,
                  isMainWorktree: isMain,
                  upstream: upstreams.get(curBranch) ?? null,
                });
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

    // Prune dirty tracking for sessions that no longer exist
    const activeSessions = new Set(sessions);
    for (const s of this.dirtySessions) {
      if (!activeSessions.has(s)) this.dirtySessions.delete(s);
    }

    const windows = activeSession
      ? await this.tmux.listWindows(activeSession)
      : [];

    return { entries, repos: [...repoSet.entries()], windows };
  }

  private async detectClaudeStatus(session: string): Promise<ClaudeStatus> {
    const panes = await this.tmux.listPanes(session);
    if (!panes) return 'none';

    let claudePaneId: string | null = null;
    for (const line of panes.split('\n')) {
      const [id, winName] = line.split('\t');
      if (winName === 'Claude Code') {
        claudePaneId = id;
        break;
      }
    }
    if (!claudePaneId) return 'none';

    const content = await this.tmux.capturePaneContent(claudePaneId);
    const raw = parseRawStatus(content);

    if (raw) {
      this.dirtySessions.add(session);
      return raw;
    }

    return this.dirtySessions.has(session) ? 'done' : 'new';
  }
}
