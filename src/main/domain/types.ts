// ── Result type for IPC responses ─────────────────────────────────
export type Result<T> =
  | { success: true; data: T }
  | { success: false; error: string };

// ── Claude status ─────────────────────────────────────────────────
export type ClaudeStatus = 'new' | 'busy' | 'action' | 'done' | 'none';

// ── Window info ───────────────────────────────────────────────────
export type WindowInfo = {
  index: number;
  name: string;
  active: boolean;
};

// ── Session / state ───────────────────────────────────────────────
export type SessionEntry = {
  repo: string;
  branch: string;
  tmuxSession: string | null;
  status: ClaudeStatus;
  worktreePath: string | null;
  isMainWorktree: boolean;
  upstream: string | null;
};

export type AppState = {
  entries: SessionEntry[];
  repos: [name: string, path: string][];
  windows: WindowInfo[];
};

// ── Theme ─────────────────────────────────────────────────────────
export type ThemeColors = Record<string, string>;

// ── Preferences ──────────────────────────────────────────────────
export interface Preferences {
  theme?: string; // 'system' | built-in theme slug
}

// ── Branch info (for new worktree dialog) ─────────────────────────
export type BranchInfo = {
  name: string;
  isLocal: boolean;
  isRemote: boolean;
};

// ── Worktree operations ───────────────────────────────────────────
export type CreateWorktreeParams = {
  repo: string;
  repoRoot: string;
  branch: string;
  base: string;
  install: boolean;
};

export type CleanCandidate = {
  repo: string;
  repoRoot: string;
  branch: string;
  worktreePath: string;
  reason: 'merged' | 'remote-deleted';
};

export type CleanTarget = {
  repoRoot: string;
  branch: string;
  worktreePath: string;
  deleteBranch: boolean;
};

export type CleanReport = {
  removed: number;
  errors: string[];
};

// ── Workspace ────────────────────────────────────────────────────
export type WorkspaceOrdering = {
  sessions?: string[];
  repos?: string[];
  repoSessions?: Record<string, string[]>;
};

export type PinnedRepo = {
  path: string;
  repoName: string;
};

export type PersistedSession = {
  tmuxSession: string;
  type: SessionType;
  directory: string;
  windows: string[];
};

export type Workspace = {
  id: string;
  name: string;
  directory: string;
  ordering?: WorkspaceOrdering;
  pinnedRepos?: PinnedRepo[];
  sessions?: PersistedSession[];
};

export type SessionType = 'workspace' | 'directory' | 'worktree';

export type SessionTab = {
  workspaceId: string | null;
  type: SessionType;
  tmuxSession: string;
  repoName: string | null;
  branch: string | null;
  worktreePath: string | null;
  status: ClaudeStatus;
  active: boolean;
};

// ── Workspace state (new model) ──────────────────────────────────
export type RepoGroupState = {
  repoName: string;
  repoRoot: string;
  currentBranch: string | null;
  sessions: SessionTab[];
};

export type WorkspaceState = {
  workspace: Workspace | null; // null = default/standalone workspace
  sessions: SessionTab[];      // workspace-type sessions (non-repo)
  repoGroups: RepoGroupState[];
  status: ClaudeStatus;
};

export type WorkspaceAppState = {
  defaultWorkspace: WorkspaceState;
  workspaces: WorkspaceState[];
  windows: WindowInfo[];
};

// ── Status ranking ───────────────────────────────────────────────
const STATUS_RANK: Record<ClaudeStatus, number> = {
  action: 4,
  busy: 3,
  done: 2,
  new: 1,
  none: 0,
};

export function worstStatus(statuses: ClaudeStatus[]): ClaudeStatus {
  if (statuses.length === 0) return 'none';
  let worst: ClaudeStatus = 'none';
  for (const s of statuses) {
    if (STATUS_RANK[s] > STATUS_RANK[worst]) worst = s;
  }
  return worst;
}

// ── .wt config ────────────────────────────────────────────────────
export type GustavConfig = {
  env: Record<string, string>;
  copy: string[];
  install: string;
  base: string;
  hooks: Record<string, string>;
  tmux: string[];
  cleanMergedInto: string;
};

// ── Git types used by ports ───────────────────────────────────────
export type WorktreeEntry = {
  path: string;
  branch: string | null;
  head: string;
};

export type BranchExistence = 'local' | 'remote' | null;
