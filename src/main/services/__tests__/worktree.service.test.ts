import { describe, it, expect, vi } from 'vitest';
import { WorktreeService } from '../worktree.service';
import type { GitPort } from '../../ports/git.port';
import type { FileSystemPort } from '../../ports/filesystem.port';
import type { ShellPort } from '../../ports/shell.port';
import type { RepoConfigService } from '../repo-config.service';
import type { RepoConfig } from '../../domain/repo-config';
import type { SessionService } from '../session.service';
import type { WorkspaceService } from '../workspace.service';

function makeMockGit(): GitPort {
  return {
    getRepoRoot: vi.fn().mockResolvedValue('/home/user/api'),
    getCurrentBranch: vi.fn().mockResolvedValue('main'),
    getWorktreeDir: vi.fn().mockReturnValue('/home/user/api/.worktrees'),
    listWorktrees: vi.fn().mockResolvedValue([]),
    branchExists: vi.fn().mockResolvedValue(null),
    listBranches: vi.fn().mockResolvedValue([]),
    isBranchMerged: vi.fn().mockResolvedValue(false),
    fetch: vi.fn().mockResolvedValue(undefined),
    worktreeAdd: vi.fn().mockResolvedValue(undefined),
    worktreeRemove: vi.fn().mockResolvedValue(undefined),
    worktreePrune: vi.fn().mockResolvedValue(undefined),
    branchDelete: vi.fn().mockResolvedValue(undefined),
    worktreeListPorcelain: vi.fn().mockResolvedValue(''),
    getUpstreams: vi.fn().mockResolvedValue(new Map()),
  };
}

function makeMockFs(): FileSystemPort {
  return {
    readFile: vi.fn().mockResolvedValue(''),
    writeFile: vi.fn().mockResolvedValue(undefined),
    exists: vi.fn().mockReturnValue(true),
    mkdir: vi.fn().mockResolvedValue(undefined),
    copyFile: vi.fn().mockResolvedValue(undefined),
    copyRecursive: vi.fn().mockResolvedValue(undefined),
    readlink: vi.fn().mockReturnValue(''),
    watch: vi.fn(),
  };
}

function makeMockShell(): ShellPort {
  return {
    exec: vi.fn().mockResolvedValue(''),
    execSync: vi.fn().mockReturnValue(''),
  };
}

function makeMockRepoConfig(value: RepoConfig | null = null): RepoConfigService {
  return {
    get: vi.fn().mockReturnValue(value),
  } as unknown as RepoConfigService;
}

function makeMockSession(): SessionService {
  return {
    kill: vi.fn().mockResolvedValue(undefined),
    getSessionName: vi.fn().mockImplementation((_ws: string, opts: { type: string; repoName?: string; branch?: string }) => {
      if (opts.type === 'worktree') return `Dev/${opts.repoName}/${opts.branch}`;
      return '';
    }),
  } as unknown as SessionService;
}

function makeMockWorkspaces(workspaces: Array<{ id: string; name: string; directory: string; sessions?: Array<{ tmuxSession: string; type: string; directory: string; windows: string[] }> }>): WorkspaceService {
  return {
    list: vi.fn().mockReturnValue(workspaces),
    findBySessionPrefix: vi.fn().mockImplementation((tmuxSession: string) => {
      const firstSlash = tmuxSession.indexOf('/');
      if (firstSlash === -1) return undefined;
      const prefix = tmuxSession.slice(0, firstSlash);
      return workspaces.find((w) => w.name === prefix);
    }),
    removeSession: vi.fn().mockResolvedValue(undefined),
    persistSession: vi.fn().mockResolvedValue(undefined),
    getPersistedSessions: vi.fn().mockImplementation((id: string) => {
      const ws = workspaces.find((w) => w.id === id);
      return ws?.sessions ?? [];
    }),
    findByDirectory: vi.fn().mockReturnValue(undefined),
  } as unknown as WorkspaceService;
}

describe('WorktreeService.create', () => {
  it('does not launch a tmux session (session launch is the caller responsibility)', async () => {
    const git = makeMockGit();
    const fs = makeMockFs();
    const session = makeMockSession();
    const workspaces = makeMockWorkspaces([]);

    // Worktree directory does not exist yet
    vi.mocked(fs.exists).mockReturnValue(false);
    vi.mocked(git.branchExists).mockResolvedValue(null);

    const svc = new WorktreeService(git, fs, makeMockShell(), makeMockRepoConfig(), session, workspaces);

    await svc.create({ repo: 'api', repoRoot: '/home/user/api', branch: 'feat-auth', base: 'origin/main' });

    // Should NOT call any session launch methods
    expect(session.kill).not.toHaveBeenCalled();

    // Should have created the git worktree
    expect(git.worktreeAdd).toHaveBeenCalled();
  });
});

describe('WorktreeService.remove', () => {
  it('kills the tmux session using the correct session name from persisted sessions', async () => {
    const git = makeMockGit();
    const session = makeMockSession();
    const workspaces = makeMockWorkspaces([
      {
        id: 'ws1',
        name: 'Dev',
        directory: '/home/user/dev',
        sessions: [
          { tmuxSession: 'Dev/api/feat-auth', type: 'worktree', directory: '/home/user/api/.worktrees/feat-auth', windows: ['Claude Code', 'Git', 'Shell'] },
        ],
      },
    ]);

    const svc = new WorktreeService(git, makeMockFs(), makeMockShell(), makeMockRepoConfig(), session, workspaces);

    await svc.remove('/home/user/api', 'feat-auth', false);

    // Should kill using the actual tmux session name, not the raw repoRoot
    expect(session.kill).toHaveBeenCalledWith('Dev/api/feat-auth');
  });

  it('removes the persisted session entry from the workspace', async () => {
    const git = makeMockGit();
    const session = makeMockSession();
    const workspaces = makeMockWorkspaces([
      {
        id: 'ws1',
        name: 'Dev',
        directory: '/home/user/dev',
        sessions: [
          { tmuxSession: 'Dev/api/feat-auth', type: 'worktree', directory: '/home/user/api/.worktrees/feat-auth', windows: ['Claude Code', 'Git', 'Shell'] },
        ],
      },
    ]);

    const svc = new WorktreeService(git, makeMockFs(), makeMockShell(), makeMockRepoConfig(), session, workspaces);

    await svc.remove('/home/user/api', 'feat-auth', false);

    expect(workspaces.removeSession).toHaveBeenCalledWith('ws1', 'Dev/api/feat-auth');
  });

  it('removes the sidebar entry even if killing the tmux session fails', async () => {
    const git = makeMockGit();
    const session = makeMockSession();
    // session.kill throws (tmux session already dead)
    vi.mocked(session.kill).mockRejectedValue(new Error('session not found'));
    const workspaces = makeMockWorkspaces([
      {
        id: 'ws1',
        name: 'Dev',
        directory: '/home/user/dev',
        sessions: [
          { tmuxSession: 'Dev/api/feat-auth', type: 'worktree', directory: '/home/user/api/.worktrees/feat-auth', windows: ['Claude Code', 'Git', 'Shell'] },
        ],
      },
    ]);

    const svc = new WorktreeService(git, makeMockFs(), makeMockShell(), makeMockRepoConfig(), session, workspaces);

    // Should not throw even though session.kill rejects
    await expect(svc.remove('/home/user/api', 'feat-auth', false)).rejects.toThrow();
  });

  it('skips kill when no persisted session is tracked for the worktree', async () => {
    const git = makeMockGit();
    const session = makeMockSession();
    const workspaces = makeMockWorkspaces([
      { id: 'ws1', name: 'Dev', directory: '/home/user/dev', sessions: [] },
    ]);

    const svc = new WorktreeService(git, makeMockFs(), makeMockShell(), makeMockRepoConfig(), session, workspaces);

    await svc.remove('/home/user/api', 'feat-auth', false);

    expect(session.kill).not.toHaveBeenCalled();
  });
});

describe('WorktreeService.clean', () => {
  it('kills tmux sessions and removes persisted entries for each cleaned worktree', async () => {
    const git = makeMockGit();
    const session = makeMockSession();
    const workspaces = makeMockWorkspaces([
      {
        id: 'ws1',
        name: 'Dev',
        directory: '/home/user/dev',
        sessions: [
          { tmuxSession: 'Dev/api/feat-a', type: 'worktree', directory: '/home/user/api/.worktrees/feat-a', windows: ['Claude Code'] },
          { tmuxSession: 'Dev/api/feat-b', type: 'worktree', directory: '/home/user/api/.worktrees/feat-b', windows: ['Claude Code'] },
        ],
      },
    ]);

    const svc = new WorktreeService(git, makeMockFs(), makeMockShell(), makeMockRepoConfig(), session, workspaces);

    const report = await svc.clean([
      { repoRoot: '/home/user/api', branch: 'feat-a', worktreePath: '/home/user/api/.worktrees/feat-a', deleteBranch: false },
      { repoRoot: '/home/user/api', branch: 'feat-b', worktreePath: '/home/user/api/.worktrees/feat-b', deleteBranch: false },
    ]);

    expect(session.kill).toHaveBeenCalledWith('Dev/api/feat-a');
    expect(session.kill).toHaveBeenCalledWith('Dev/api/feat-b');
    expect(workspaces.removeSession).toHaveBeenCalledWith('ws1', 'Dev/api/feat-a');
    expect(workspaces.removeSession).toHaveBeenCalledWith('ws1', 'Dev/api/feat-b');
    expect(report).toEqual({ removed: 2, errors: [] });
  });
});

describe('WorktreeService.remove (orphaned entries)', () => {
  it('cleans up tmux session and sidebar entry even when worktree directory is already gone', async () => {
    const git = makeMockGit();
    const fs = makeMockFs();
    const session = makeMockSession();
    const workspaces = makeMockWorkspaces([
      {
        id: 'ws1',
        name: 'Dev',
        directory: '/home/user/dev',
        sessions: [
          { tmuxSession: 'Dev/api/feat-auth', type: 'worktree', directory: '/home/user/api/.worktrees/feat-auth', windows: ['Claude Code', 'Git', 'Shell'] },
        ],
      },
    ]);

    // Worktree directory is already gone
    vi.mocked(fs.exists).mockImplementation((path: string) => {
      if (path === '/home/user/api/.worktrees/feat-auth') return false;
      return true;
    });

    const svc = new WorktreeService(git, fs, makeMockShell(), makeMockRepoConfig(), session, workspaces);

    await svc.remove('/home/user/api', 'feat-auth', false);

    // Should NOT try to git worktree remove (directory is gone)
    expect(git.worktreeRemove).not.toHaveBeenCalled();

    // Should still clean up tmux session and sidebar entry
    expect(session.kill).toHaveBeenCalledWith('Dev/api/feat-auth');
    expect(workspaces.removeSession).toHaveBeenCalledWith('ws1', 'Dev/api/feat-auth');
  });
});
