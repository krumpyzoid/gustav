import type { GitPort } from '../ports/git.port';
import type { TmuxPort } from '../ports/tmux.port';
import type { WorkspaceService } from './workspace.service';
import type { ClaudeStatus, WorkspaceAppState, WorkspaceState, SessionTab, RepoGroupState } from '../domain/types';
import { worstStatus } from '../domain/types';

/** Sort items by a persisted key order. Items not in the order list are appended, optionally with a fallback sort. */
function applyOrder<T>(
  items: T[],
  order: string[] | undefined,
  keyFn: (item: T) => string,
  fallbackSort?: (a: T, b: T) => number,
): T[] {
  if (!order || order.length === 0) {
    return fallbackSort ? [...items].sort(fallbackSort) : items;
  }
  const keyIndex = new Map(order.map((k, i) => [k, i]));
  const ordered: T[] = [];
  const rest: T[] = [];
  for (const item of items) {
    if (keyIndex.has(keyFn(item))) {
      ordered.push(item);
    } else {
      rest.push(item);
    }
  }
  ordered.sort((a, b) => keyIndex.get(keyFn(a))! - keyIndex.get(keyFn(b))!);
  if (fallbackSort) rest.sort(fallbackSort);
  return [...ordered, ...rest];
}

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
  private listener: ((state: WorkspaceAppState) => void) | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private polling = false;

  constructor(
    private git: GitPort,
    private tmux: TmuxPort,
    private workspaceService: WorkspaceService,
  ) {}

  onChange(listener: (state: WorkspaceAppState) => void): void {
    this.listener = listener;
  }

  startPolling(intervalMs = 5000, getActiveSession?: () => string | null): void {
    this.timer = setInterval(async () => {
      if (this.polling) return;
      this.polling = true;
      try {
        const state = await this.collectWorkspaces(getActiveSession?.() ?? undefined);
        this.listener?.(state);
      } finally {
        this.polling = false;
      }
    }, intervalMs);
  }

  stopPolling(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async collectWorkspaces(activeSession?: string): Promise<WorkspaceAppState> {
    const workspaces = this.workspaceService?.list() ?? [];
    const sessions = await this.tmux.listSessions();
    const wsNameSet = new Set(workspaces.map((w) => w.name));

    // Parse each tmux session into a SessionTab
    const sessionTabs = await Promise.all(
      sessions
        .filter((s) => !s.startsWith('_wt_'))
        .map(async (tmuxSession): Promise<SessionTab> => {
          const status = await this.detectClaudeStatus(tmuxSession);

          // Standalone: _standalone/label
          if (tmuxSession.startsWith('_standalone/')) {
            const label = tmuxSession.slice('_standalone/'.length);
            return { workspaceId: null, type: 'workspace', tmuxSession, repoName: null, branch: null, worktreePath: null, status, active: true };
          }

          // Find matching workspace by prefix
          const firstSlash = tmuxSession.indexOf('/');
          if (firstSlash === -1) {
            // No slash → standalone-like
            return { workspaceId: null, type: 'workspace', tmuxSession, repoName: null, branch: null, worktreePath: null, status, active: true };
          }

          const prefix = tmuxSession.slice(0, firstSlash);
          const rest = tmuxSession.slice(firstSlash + 1);

          // Check if prefix matches a workspace name
          const ws = workspaces.find((w) => w.name === prefix);

          if (rest === '_ws') {
            // Workspace session
            return { workspaceId: ws?.id ?? null, type: 'workspace', tmuxSession, repoName: null, branch: null, worktreePath: null, status, active: true };
          }

          // rest could be "repoName/_dir" or "repoName/branch"
          const secondSlash = rest.indexOf('/');
          if (secondSlash === -1) {
            // Single segment after prefix — legacy or unknown
            return { workspaceId: ws?.id ?? null, type: 'workspace', tmuxSession, repoName: null, branch: null, worktreePath: null, status, active: true };
          }

          const repoName = rest.slice(0, secondSlash);
          const branchOrDir = rest.slice(secondSlash + 1);

          if (branchOrDir === '_dir') {
            let branch: string | null = null;
            try {
              const cwd = (await this.tmux.displayMessage(`${tmuxSession}:0`, '#{pane_current_path}')).trim();
              if (cwd) branch = await this.git.getCurrentBranch(cwd);
            } catch {}
            return { workspaceId: ws?.id ?? null, type: 'directory', tmuxSession, repoName, branch, worktreePath: null, status, active: true };
          }

          return { workspaceId: ws?.id ?? null, type: 'worktree', tmuxSession, repoName, branch: branchOrDir, worktreePath: null, status, active: true };
        }),
    );

    // Prune dirty tracking
    const activeSessions = new Set(sessions);
    for (const s of this.dirtySessions) {
      if (!activeSessions.has(s)) this.dirtySessions.delete(s);
    }

    // Group into workspace buckets
    const defaultSessions: SessionTab[] = [];
    const wsSessionMap = new Map<string, SessionTab[]>();

    for (const ws of workspaces) {
      wsSessionMap.set(ws.id, []);
    }

    for (const tab of sessionTabs) {
      if (tab.workspaceId && wsSessionMap.has(tab.workspaceId)) {
        wsSessionMap.get(tab.workspaceId)!.push(tab);
      } else {
        defaultSessions.push(tab);
      }
    }

    // Build workspace states
    const workspaceStates: WorkspaceState[] = await Promise.all(workspaces.map(async (ws) => {
      const allTabs = wsSessionMap.get(ws.id) ?? [];
      const wsSessions = allTabs.filter((t) => t.type === 'workspace');
      const repoTabs = allTabs.filter((t) => t.type !== 'workspace');

      // Group repo tabs by repoName
      const repoTabMap = new Map<string, SessionTab[]>();
      for (const tab of repoTabs) {
        if (!tab.repoName) continue;
        const group = repoTabMap.get(tab.repoName) ?? [];
        group.push(tab);
        repoTabMap.set(tab.repoName, group);
      }

      const ord = ws.ordering;
      const pinnedRepos = ws.pinnedRepos ?? [];

      // Build repo groups from pinned repos (pinned repos are the gate)
      const repoGroups: RepoGroupState[] = await Promise.all(
        pinnedRepos.map(async (pinned) => {
          const repoName = pinned.repoName;
          const repoRoot = pinned.path;
          const tabs = repoTabMap.get(repoName) ?? [];

          // Resolve current branch from git
          let currentBranch: string | null = null;
          try {
            currentBranch = await this.git.getCurrentBranch(repoRoot);
          } catch {}

          // Ensure a directory session entry always exists for pinned repos
          const hasDirSession = tabs.some((t) => t.type === 'directory');
          if (!hasDirSession) {
            tabs.push({
              workspaceId: ws.id,
              type: 'directory',
              tmuxSession: `${ws.name}/${repoName}/_dir`,
              repoName,
              branch: currentBranch,
              worktreePath: null,
              status: 'none',
              active: false,
            });
          }

          // Discover worktrees and add inactive entries for ones without tmux sessions
          try {
            const wtDir = this.git.getWorktreeDir(repoRoot);
            const worktrees = await this.git.listWorktrees(repoRoot, wtDir);
            const activeBranches = new Set(tabs.filter((t) => t.type === 'worktree').map((t) => t.branch));
            for (const wt of worktrees) {
              if (wt.branch && !activeBranches.has(wt.branch)) {
                tabs.push({
                  workspaceId: ws.id,
                  type: 'worktree',
                  tmuxSession: `${ws.name}/${repoName}/${wt.branch}`,
                  repoName,
                  branch: wt.branch,
                  worktreePath: wt.path,
                  status: 'none',
                  active: false,
                });
              }
            }
          } catch {}

          return {
            repoName,
            repoRoot,
            currentBranch,
            sessions: applyOrder(
              tabs,
              ord?.repoSessions?.[repoName],
              (t) => t.tmuxSession,
              (a, b) => {
                if (a.type === 'directory' && b.type !== 'directory') return -1;
                if (a.type !== 'directory' && b.type === 'directory') return 1;
                return (a.branch ?? '').localeCompare(b.branch ?? '');
              },
            ),
          };
        }),
      );

      const allStatuses = allTabs.map((t) => t.status);
      return {
        workspace: ws,
        sessions: applyOrder(wsSessions, ord?.sessions, (t) => t.tmuxSession),
        repoGroups: applyOrder(repoGroups, ord?.repos, (rg) => rg.repoName),
        status: worstStatus(allStatuses),
      };
    }));

    const defaultAllStatuses = defaultSessions.map((t) => t.status);
    const defaultWorkspace: WorkspaceState = {
      workspace: null,
      sessions: defaultSessions,
      repoGroups: [],
      status: worstStatus(defaultAllStatuses),
    };

    const windows = activeSession
      ? await this.tmux.listWindows(activeSession)
      : [];

    return { defaultWorkspace, workspaces: workspaceStates, windows };
  }

  private async detectClaudeStatus(session: string): Promise<ClaudeStatus> {
    const panes = await this.tmux.listPanes(session);
    if (!panes) return 'none';

    // Find all panes running the claude command (by pane_current_command, not window name)
    const claudePaneIds: string[] = [];
    for (const line of panes.split('\n')) {
      if (!line.trim()) continue;
      const [id, , command] = line.split('\t');
      if (command === 'claude') {
        claudePaneIds.push(id);
      }
    }
    if (claudePaneIds.length === 0) return 'none';

    // Capture content from all claude panes and compute per-pane status
    const paneStatuses = await Promise.all(
      claudePaneIds.map(async (paneId): Promise<ClaudeStatus> => {
        const content = await this.tmux.capturePaneContent(paneId);
        const raw = parseRawStatus(content);

        if (raw) {
          this.dirtySessions.add(session);
          return raw;
        }

        return this.dirtySessions.has(session) ? 'done' : 'new';
      }),
    );

    // Return the worst status across all claude panes
    return worstStatus(paneStatuses);
  }
}
