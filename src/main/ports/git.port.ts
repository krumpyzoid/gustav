import type { WorktreeEntry, BranchExistence, BranchInfo } from '../domain/types';

export interface GitPort {
  getRepoRoot(cwd: string): Promise<string>;
  getWorktreeDir(repoRoot: string): string;
  listWorktrees(repoRoot: string, wtDir: string, opts?: { includeMain?: boolean }): Promise<WorktreeEntry[]>;
  branchExists(repoRoot: string, branch: string): Promise<BranchExistence>;
  listBranches(repoRoot: string): Promise<BranchInfo[]>;
  isBranchMerged(repoRoot: string, branch: string, into: string): Promise<boolean>;
  fetch(repoRoot: string, opts?: { prune?: boolean }): Promise<void>;
  worktreeAdd(repoRoot: string, path: string, branch: string, opts?: { newBranch?: boolean; base?: string }): Promise<void>;
  worktreeRemove(repoRoot: string, path: string): Promise<void>;
  worktreePrune(repoRoot: string): Promise<void>;
  branchDelete(repoRoot: string, branch: string): Promise<void>;
  worktreeListPorcelain(repoRoot: string): Promise<string>;
  getUpstreams(repoRoot: string): Promise<Map<string, string>>;
}
