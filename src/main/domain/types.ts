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

// ── Theme ─────────────────────────────────────────────────────────
export type ThemeColors = Record<string, string>;

// ── Preferences ──────────────────────────────────────────────────
import type { TabConfig } from './tab-config';
export type SessionSupervisorBackend = 'tmux' | 'native';
export interface Preferences {
  theme?: string; // 'system' | built-in theme slug
  defaultTabs?: TabConfig[];
  /**
   * Strangler flag for the Phase 3 supervisor migration.
   * - `'tmux'` (default): sessions go through the tmux-backed path (legacy).
   * - `'native'`: new sessions are owned directly by the in-process
   *   `NativeSupervisor` (no tmux).
   *
   * Existing sessions stay on whichever backend created them. Phase 3 has
   * no UI control for this — toggle by editing preferences.json.
   */
  sessionSupervisor?: SessionSupervisorBackend;
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

export type WindowSpec = {
  name: string;
  kind: 'claude' | 'command';
  command?: string;
  args?: string;
  claudeSessionId?: string;
  directory?: string;
};

/** Which backend owns the PTYs for a persisted session.
 * Absent on legacy entries — treat as `'tmux'` via {@link getBackend}. */
export type SessionBackend = 'tmux' | 'native';

export type PersistedSession = {
  /** Stable session id. The field is named `tmuxSession` for backward compat —
   * for native-backed sessions it is just an arbitrary id following the same
   * naming convention (`workspace/repo/branch`, `_standalone/label`, etc.). */
  tmuxSession: string;
  type: SessionType;
  directory: string;
  windows: WindowSpec[];
  /** Optional. Absent = `'tmux'` (legacy default). */
  backend?: SessionBackend;
};

/** Returns the backend for a persisted session, defaulting to `'tmux'` for
 * entries that predate the strangler flag. */
export function getBackend(session: PersistedSession): SessionBackend {
  return session.backend ?? 'tmux';
}

export type Workspace = {
  id: string;
  name: string;
  directory: string;
  ordering?: WorkspaceOrdering;
  pinnedRepos?: PinnedRepo[];
  sessions?: PersistedSession[];
  defaultTabs?: TabConfig[];
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

// ── Git types used by ports ───────────────────────────────────────
export type WorktreeEntry = {
  path: string;
  branch: string | null;
  head: string;
};

export type BranchExistence = 'local' | 'remote' | null;
