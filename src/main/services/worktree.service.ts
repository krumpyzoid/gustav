import { join, basename, resolve } from 'node:path';
import type { GitPort } from '../ports/git.port';
import type { FileSystemPort } from '../ports/filesystem.port';
import type { ShellPort } from '../ports/shell.port';
import type { RepoConfigService } from './repo-config.service';
import type { SessionService } from './session.service';
import type { WorkspaceService } from './workspace.service';
import type {
  CreateWorktreeParams,
  CleanCandidate,
  CleanTarget,
  CleanReport,
} from '../domain/types';

export class WorktreeService {
  constructor(
    private git: GitPort,
    private fs: FileSystemPort,
    private shell: ShellPort,
    private repoConfig: RepoConfigService,
    private session: SessionService,
    private workspaces: WorkspaceService,
  ) {}

  async create(params: CreateWorktreeParams): Promise<void> {
    const { repoRoot, branch, base } = params;
    const wtDir = this.git.getWorktreeDir(repoRoot);
    const wtPath = join(wtDir, branch);

    // Path-traversal guard: a `branch` like '../escape' would resolve outside
    // the repo's .worktrees directory. Reject anything that doesn't resolve
    // strictly inside wtDir before any filesystem mutation runs.
    const wtPathAbs = resolve(wtPath);
    const wtDirAbs = resolve(wtDir);
    if (wtPathAbs !== wtDirAbs && !wtPathAbs.startsWith(wtDirAbs + '/')) {
      throw new Error(`Invalid branch name: resolved path ${wtPathAbs} escapes worktree dir ${wtDirAbs}`);
    }

    const cfg = this.repoConfig.get(repoRoot);

    if (this.fs.exists(wtPath)) {
      throw new Error(`Worktree already exists at ${wtPath}`);
    }

    await this.fs.mkdir(wtDir);

    const exists = await this.git.branchExists(repoRoot, branch);
    if (exists) {
      await this.git.worktreeAdd(repoRoot, wtPath, branch);
    } else {
      const baseRef = base || cfg?.baseBranch || 'origin/main';
      await this.git.fetch(repoRoot);
      await this.git.worktreeAdd(repoRoot, wtPath, branch, { newBranch: true, base: baseRef });
    }

    // Always copy .claude/settings.local.json (not user-configurable, predates [copy]).
    const settingsSrc = join(repoRoot, '.claude', 'settings.local.json');
    if (this.fs.exists(settingsSrc)) {
      await this.fs.mkdir(join(wtPath, '.claude'));
      await this.fs.copyFile(settingsSrc, join(wtPath, '.claude', 'settings.local.json'));
    }

    // .env handling: write configured env, else copy repo's .env if any.
    const envEntries = Object.entries(cfg?.env ?? {});
    if (envEntries.length > 0) {
      const envContent = envEntries.map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
      await this.fs.writeFile(join(wtPath, '.env'), envContent);
    } else if (this.fs.exists(join(repoRoot, '.env'))) {
      await this.fs.copyFile(join(repoRoot, '.env'), join(wtPath, '.env'));
    }

    // Post-create command (replaces the old [install] block + checkbox).
    // Run the user-configured command directly via shell.exec — Node's exec
    // already wraps in /bin/sh. The previous outer `sh -c '${cmd}'` wrapper
    // could be broken by single quotes inside the command.
    if (cfg?.postCreateCommand) {
      await this.shell.exec(cfg.postCreateCommand, { cwd: wtPath });
    }
  }

  async remove(repoRoot: string, branch: string, deleteBranch: boolean): Promise<void> {
    const wtDir = this.git.getWorktreeDir(repoRoot);
    const wtPath = join(wtDir, branch);

    if (this.fs.exists(wtPath)) {
      await this.git.worktreeRemove(repoRoot, wtPath);
    }

    await this.killSessionAndRemoveEntry(wtPath);

    if (deleteBranch) {
      try {
        await this.git.branchDelete(repoRoot, branch);
      } catch {
        // Branch may already be deleted or not exist
      }
    }
  }

  async getCleanCandidates(): Promise<CleanCandidate[]> {
    const candidates: CleanCandidate[] = [];

    const repoSet = new Map<string, string>();
    for (const ws of this.workspaces.list()) {
      if (!this.fs.exists(ws.directory)) continue;
      for (const repoPath of this.workspaces.discoverGitRepos(ws.directory, 3)) {
        repoSet.set(basename(repoPath), repoPath);
      }
    }

    for (const [repoName, repoRoot] of repoSet) {
      if (!this.fs.exists(repoRoot)) continue;

      const cfg = this.repoConfig.get(repoRoot);
      // Slice C: cleanup-merged requires an explicit baseBranch — no fallback.
      if (!cfg?.baseBranch) continue;
      const mergedInto = cfg.baseBranch;

      try {
        await this.git.fetch(repoRoot, { prune: true });

        const wtDir = this.git.getWorktreeDir(repoRoot);
        const entries = await this.git.listWorktrees(repoRoot, wtDir);

        for (const entry of entries) {
          const branch = entry.branch;
          if (!branch) continue;

          if (await this.git.isBranchMerged(repoRoot, branch, mergedInto)) {
            candidates.push({
              repo: repoName,
              repoRoot,
              branch,
              worktreePath: entry.path,
              reason: 'merged',
            });
            continue;
          }

          const existence = await this.git.branchExists(repoRoot, branch);
          if (existence === 'local') {
            try {
              await this.shell.execFile('git', [
                '-C', repoRoot, 'show-ref', '--verify', '--quiet',
                `refs/remotes/origin/${branch}`,
              ]);
            } catch {
              candidates.push({
                repo: repoName,
                repoRoot,
                branch,
                worktreePath: entry.path,
                reason: 'remote-deleted',
              });
            }
          }
        }
      } catch {
        // Skip repos with errors
      }
    }

    return candidates;
  }

  async clean(targets: CleanTarget[]): Promise<CleanReport> {
    const report: CleanReport = { removed: 0, errors: [] };

    const byRepo = new Map<string, CleanTarget[]>();
    for (const t of targets) {
      const group = byRepo.get(t.repoRoot) ?? [];
      group.push(t);
      byRepo.set(t.repoRoot, group);
    }

    for (const [repoRoot, repoTargets] of byRepo) {
      for (const target of repoTargets) {
        try {
          await this.git.worktreeRemove(repoRoot, target.worktreePath);
          await this.killSessionAndRemoveEntry(target.worktreePath);

          if (target.deleteBranch) {
            try {
              await this.git.branchDelete(repoRoot, target.branch);
            } catch {}
          }

          report.removed++;
        } catch (err) {
          report.errors.push(`${target.branch}: ${(err as Error).message}`);
        }
      }

      await this.git.worktreePrune(repoRoot);
    }

    return report;
  }

  /** Find the tmux session name for a worktree (if persisted) and clean up
   *  both tmux and persisted state. The persisted-state cleanup runs even
   *  when killing the tmux session fails — a tmux session that was already
   *  killed externally (or whose server died) shouldn't block removing the
   *  sidebar entry, since the user explicitly asked us to delete it. */
  private async killSessionAndRemoveEntry(wtPath: string): Promise<void> {
    const sessionName = this.findPersistedSessionName(wtPath);
    if (!sessionName) return;

    try {
      await this.session.kill(sessionName);
    } catch {
      // Tmux session already gone or server unreachable — proceed to clean
      // up the persisted entry regardless.
    }

    const ws = this.workspaces.findBySessionPrefix(sessionName);
    if (ws) {
      await this.workspaces.removeSession(ws.id, sessionName);
    }
  }

  /** Look up the tmux session name from persisted workspace sessions by worktree directory. */
  private findPersistedSessionName(wtPath: string): string | null {
    for (const ws of this.workspaces.list()) {
      for (const s of this.workspaces.getPersistedSessions(ws.id)) {
        if (s.directory === wtPath) return s.tmuxSession;
      }
    }
    return null;
  }
}
