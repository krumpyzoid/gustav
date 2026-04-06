// ── Result type for IPC responses ─────────────────────────────────
export type Result<T> =
  | { success: true; data: T }
  | { success: false; error: string };

// ── Claude status ─────────────────────────────────────────────────
export type ClaudeStatus = 'new' | 'busy' | 'action' | 'done' | 'none';

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
};

// ── Theme ─────────────────────────────────────────────────────────
export type ThemeColors = Record<string, string>;

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

// ── .wt config ────────────────────────────────────────────────────
export type WtConfig = {
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
