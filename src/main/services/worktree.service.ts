import { join, dirname } from 'node:path';
import type { GitPort } from '../ports/git.port';
import type { FileSystemPort } from '../ports/filesystem.port';
import type { ShellPort } from '../ports/shell.port';
import type { ConfigService } from './config.service';
import type { SessionService } from './session.service';
import type { WorkspaceService } from './workspace.service';
import { basename } from 'node:path';
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
    private config: ConfigService,
    private session: SessionService,
    private workspaces: WorkspaceService,
  ) {}

  async create(params: CreateWorktreeParams): Promise<void> {
    const { repoRoot, branch, base, install } = params;
    const wtDir = this.git.getWorktreeDir(repoRoot);
    const wtPath = join(wtDir, branch);
    const config = await this.config.parse(repoRoot);

    if (this.fs.exists(wtPath)) {
      throw new Error(`Worktree already exists at ${wtPath}`);
    }

    await this.fs.mkdir(wtDir);

    // Check if branch already exists
    const exists = await this.git.branchExists(repoRoot, branch);

    if (exists) {
      await this.git.worktreeAdd(repoRoot, wtPath, branch);
    } else {
      const baseRef = base || config.base || 'origin/main';
      await this.git.fetch(repoRoot);
      await this.git.worktreeAdd(repoRoot, wtPath, branch, { newBranch: true, base: baseRef });
    }

    // pre_new hook
    await this.runHook(config.hooks.pre_new, branch, wtPath, repoRoot);

    // Copy .claude/settings.local.json
    const settingsSrc = join(repoRoot, '.claude', 'settings.local.json');
    if (this.fs.exists(settingsSrc)) {
      await this.fs.mkdir(join(wtPath, '.claude'));
      await this.fs.copyFile(settingsSrc, join(wtPath, '.claude', 'settings.local.json'));
    }

    // .env handling
    const envKeys = Object.keys(config.env);
    if (envKeys.length > 0) {
      const envContent = envKeys.map((k) => `${k}=${config.env[k]}`).join('\n') + '\n';
      await this.fs.writeFile(join(wtPath, '.env'), envContent);
    } else if (this.fs.exists(join(repoRoot, '.env'))) {
      await this.fs.copyFile(join(repoRoot, '.env'), join(wtPath, '.env'));
    }

    // [copy] section
    for (const relPath of config.copy) {
      const src = join(repoRoot, relPath);
      const dst = join(wtPath, relPath);
      if (this.fs.exists(src)) {
        await this.fs.mkdir(dirname(dst));
        await this.fs.copyRecursive(src, dst);
      }
    }

    // [install] section
    if (install && config.install) {
      await this.shell.exec(`sh -c '${config.install}'`, { cwd: wtPath });
    }

    // post_new hook
    await this.runHook(config.hooks.post_new, branch, wtPath, repoRoot);
  }

  async remove(repoRoot: string, branch: string, deleteBranch: boolean): Promise<void> {
    const wtDir = this.git.getWorktreeDir(repoRoot);
    const wtPath = join(wtDir, branch);
    const config = await this.config.parse(repoRoot);

    // pre_rm hook
    await this.runHook(config.hooks.pre_rm, branch, wtPath, repoRoot);

    // Remove worktree (skip if directory is already gone)
    if (this.fs.exists(wtPath)) {
      await this.git.worktreeRemove(repoRoot, wtPath);
    }

    // Kill tmux session and remove persisted sidebar entry
    await this.killSessionAndRemoveEntry(repoRoot, branch, wtPath);

    // Optionally delete branch
    if (deleteBranch) {
      try {
        await this.git.branchDelete(repoRoot, branch);
      } catch {
        // Branch may already be deleted or not exist
      }
    }

    // post_rm hook
    await this.runHook(config.hooks.post_rm, branch, wtPath, repoRoot);
  }

  async getCleanCandidates(): Promise<CleanCandidate[]> {
    const candidates: CleanCandidate[] = [];

    // Discover repos from all workspaces
    const repoSet = new Map<string, string>();
    for (const ws of this.workspaces.list()) {
      if (!this.fs.exists(ws.directory)) continue;
      for (const repoPath of this.workspaces.discoverGitRepos(ws.directory, 3)) {
        repoSet.set(basename(repoPath), repoPath);
      }
    }

    for (const [repoName, repoRoot] of repoSet) {
      if (!this.fs.exists(repoRoot)) continue;

      try {
        const config = await this.config.parse(repoRoot);
        const mergedInto = config.cleanMergedInto;

        await this.git.fetch(repoRoot, { prune: true });

        const wtDir = this.git.getWorktreeDir(repoRoot);
        const entries = await this.git.listWorktrees(repoRoot, wtDir);

        for (const entry of entries) {
          const branch = entry.branch;
          if (!branch) continue;

          // Check if merged
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

          // Check if remote branch deleted
          const existence = await this.git.branchExists(repoRoot, branch);
          if (existence === 'local') {
            try {
              await this.shell.exec(
                `git -C '${repoRoot}' show-ref --verify --quiet refs/remotes/origin/${branch}`,
              );
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

    // Group by repoRoot for hook calls
    const byRepo = new Map<string, CleanTarget[]>();
    for (const t of targets) {
      const group = byRepo.get(t.repoRoot) ?? [];
      group.push(t);
      byRepo.set(t.repoRoot, group);
    }

    for (const [repoRoot, repoTargets] of byRepo) {
      const config = await this.config.parse(repoRoot);

      // pre_clean hook
      await this.runHook(config.hooks.pre_clean, '', repoRoot, repoRoot);

      for (const target of repoTargets) {
        try {
          await this.git.worktreeRemove(repoRoot, target.worktreePath);
          await this.killSessionAndRemoveEntry(repoRoot, target.branch, target.worktreePath);

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
      await this.runHook(config.hooks.post_clean, '', repoRoot, repoRoot);
    }

    return report;
  }

  /** Find the tmux session name for a worktree and clean up both tmux and persisted state. */
  private async killSessionAndRemoveEntry(repoRoot: string, branch: string, wtPath: string): Promise<void> {
    const sessionName = this.findPersistedSessionName(wtPath)
      ?? this.session.getLegacySessionName(repoRoot, branch);

    await this.session.kill(sessionName);

    const ws = this.workspaces.findBySessionPrefix(sessionName);
    if (ws) {
      await this.workspaces.removeSession(ws.id, sessionName);
    }
  }

  /** Look up the tmux session name from persisted workspace sessions by worktree directory. */
  private findPersistedSessionName(wtPath: string): string | null {
    for (const ws of this.workspaces.list()) {
      for (const s of ws.sessions ?? []) {
        if (s.directory === wtPath) return s.tmuxSession;
      }
    }
    return null;
  }

  private async runHook(
    cmd: string | undefined,
    branch: string,
    wtPath: string,
    repoRoot: string,
  ): Promise<void> {
    if (!cmd) return;
    const cwd = this.fs.exists(wtPath) ? wtPath : repoRoot;
    try {
      await this.shell.exec(`sh -c '${cmd}'`, {
        cwd,
        env: { ...process.env, WT_BRANCH: branch, WT_PATH: wtPath },
      });
    } catch (err) {
      // pre_ hooks abort, post_ hooks warn
      if (cmd.includes('pre_')) {
        throw new Error(`Hook failed: ${(err as Error).message}`);
      }
    }
  }
}
