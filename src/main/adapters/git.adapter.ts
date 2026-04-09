import { join } from 'node:path';
import type { GitPort } from '../ports/git.port';
import type { WorktreeEntry, BranchExistence, BranchInfo } from '../domain/types';
import type { ShellPort } from '../ports/shell.port';

export class GitAdapter implements GitPort {
  constructor(private shell: ShellPort) {}

  async getRepoRoot(cwd: string): Promise<string> {
    const gitCommon = await this.shell.exec(`git -C '${cwd}' rev-parse --git-common-dir`);
    if (gitCommon === '.git') {
      return this.shell.exec(`git -C '${cwd}' rev-parse --show-toplevel`);
    }
    const { dirname } = await import('node:path');
    return dirname(gitCommon);
  }

  async getCurrentBranch(repoRoot: string): Promise<string | null> {
    try {
      const branch = await this.shell.exec(`git -C '${repoRoot}' rev-parse --abbrev-ref HEAD`);
      return branch.trim() || null;
    } catch {
      return null;
    }
  }

  getWorktreeDir(repoRoot: string): string {
    return join(repoRoot, '.worktrees');
  }

  async listWorktrees(
    repoRoot: string,
    wtDir: string,
    opts?: { includeMain?: boolean },
  ): Promise<WorktreeEntry[]> {
    const raw = await this.worktreeListPorcelain(repoRoot);
    const entries: WorktreeEntry[] = [];
    let current: Partial<WorktreeEntry> = {};

    for (const line of (raw + '\n').split('\n')) {
      if (line.startsWith('worktree ')) {
        current = { path: line.slice(9) };
      } else if (line.startsWith('branch refs/heads/')) {
        current.branch = line.slice(18);
      } else if (line.startsWith('HEAD ')) {
        current.head = line.slice(5);
      } else if (line === '' && current.path) {
        const isMain = current.path === repoRoot;
        const isUnderWtDir = current.path.startsWith(wtDir);
        if (isUnderWtDir || (opts?.includeMain && isMain)) {
          entries.push({
            path: current.path,
            branch: current.branch ?? null,
            head: current.head ?? '',
          });
        }
        current = {};
      }
    }
    return entries;
  }

  async branchExists(repoRoot: string, branch: string): Promise<BranchExistence> {
    try {
      await this.shell.exec(
        `git -C '${repoRoot}' show-ref --verify --quiet refs/heads/${branch}`,
      );
      return 'local';
    } catch {
      // not local
    }
    try {
      await this.shell.exec(
        `git -C '${repoRoot}' show-ref --verify --quiet refs/remotes/origin/${branch}`,
      );
      return 'remote';
    } catch {
      return null;
    }
  }

  async listBranches(repoRoot: string): Promise<BranchInfo[]> {
    const localRaw = await this.shell.exec(
      `git -C '${repoRoot}' for-each-ref --format='%(refname:short)' refs/heads/`,
    ).catch(() => '');
    const remoteRaw = await this.shell.exec(
      `git -C '${repoRoot}' for-each-ref --format='%(refname:short)' refs/remotes/origin/`,
    ).catch(() => '');

    const locals = new Set(localRaw.split('\n').filter(Boolean));
    const remotes = new Set(
      remoteRaw
        .split('\n')
        .filter(Boolean)
        .map((r) => r.replace(/^origin\//, '')),
    );

    const allNames = new Set([...locals, ...remotes]);
    return [...allNames].map((name) => ({
      name,
      isLocal: locals.has(name),
      isRemote: remotes.has(name),
    }));
  }

  async isBranchMerged(repoRoot: string, branch: string, into: string): Promise<boolean> {
    try {
      const result = await this.shell.exec(`git -C '${repoRoot}' branch --merged ${into}`);
      return result.split('\n').some((line) => line.trim().replace(/^\* /, '') === branch);
    } catch {
      return false;
    }
  }

  async fetch(repoRoot: string, opts?: { prune?: boolean }): Promise<void> {
    const pruneFlag = opts?.prune ? ' --prune' : '';
    await this.shell.exec(`git -C '${repoRoot}' fetch origin --quiet${pruneFlag}`);
  }

  async worktreeAdd(
    repoRoot: string,
    path: string,
    branch: string,
    opts?: { newBranch?: boolean; base?: string },
  ): Promise<void> {
    if (opts?.newBranch && opts.base) {
      await this.shell.exec(`git -C '${repoRoot}' worktree add '${path}' -b '${branch}' '${opts.base}'`);
    } else {
      await this.shell.exec(`git -C '${repoRoot}' worktree add '${path}' '${branch}'`);
    }
  }

  async worktreeRemove(repoRoot: string, path: string): Promise<void> {
    await this.shell.exec(`git -C '${repoRoot}' worktree remove '${path}' --force`);
  }

  async worktreePrune(repoRoot: string): Promise<void> {
    await this.shell.exec(`git -C '${repoRoot}' worktree prune`);
  }

  async branchDelete(repoRoot: string, branch: string): Promise<void> {
    await this.shell.exec(`git -C '${repoRoot}' branch -d '${branch}'`);
  }

  async worktreeListPorcelain(repoRoot: string): Promise<string> {
    return this.shell.exec(`git -C '${repoRoot}' worktree list --porcelain`);
  }

  async getUpstreams(repoRoot: string): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    try {
      const raw = await this.shell.exec(
        `git -C '${repoRoot}' for-each-ref --format='%(refname:short) %(upstream:short)' refs/heads/`,
      );
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue;
        const spaceIdx = line.indexOf(' ');
        if (spaceIdx === -1) continue;
        const branch = line.slice(0, spaceIdx);
        const upstream = line.slice(spaceIdx + 1);
        if (upstream) result.set(branch, upstream);
      }
    } catch {}
    return result;
  }
}
