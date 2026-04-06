import { describe, it, expect, vi } from 'vitest';
import { StateService } from '../state.service';
import type { GitPort } from '../../ports/git.port';
import type { TmuxPort } from '../../ports/tmux.port';
import type { RegistryService } from '../registry.service';

function makeMockGit(): GitPort {
  return {
    getRepoRoot: vi.fn(),
    getWorktreeDir: vi.fn().mockReturnValue('/tmp/wt'),
    listWorktrees: vi.fn(),
    branchExists: vi.fn(),
    listBranches: vi.fn(),
    isBranchMerged: vi.fn(),
    fetch: vi.fn(),
    worktreeAdd: vi.fn(),
    worktreeRemove: vi.fn(),
    worktreePrune: vi.fn(),
    branchDelete: vi.fn(),
    worktreeListPorcelain: vi.fn().mockResolvedValue(''),
    getUpstreams: vi.fn().mockResolvedValue(new Map()),
  };
}

function makeMockTmux(): TmuxPort {
  return {
    listSessions: vi.fn().mockResolvedValue([]),
    newSession: vi.fn(),
    killSession: vi.fn(),
    switchClient: vi.fn(),
    displayMessage: vi.fn(),
    listPanes: vi.fn(),
    capturePaneContent: vi.fn(),
    sendKeys: vi.fn(),
  } as unknown as TmuxPort;
}

function makeMockRegistry(): RegistryService {
  return {
    load: vi.fn().mockReturnValue({}),
    save: vi.fn(),
    remove: vi.fn(),
    discoverGitRepos: vi.fn(),
    pinMany: vi.fn(),
  } as unknown as RegistryService;
}

describe('StateService.collect', () => {
  it('includes pinned repos from registry', async () => {
    const git = makeMockGit();
    const tmux = makeMockTmux();
    const registry = makeMockRegistry();
    vi.mocked(registry.load).mockReturnValue({ myrepo: '/home/user/myrepo' });
    vi.mocked(git.worktreeListPorcelain).mockResolvedValue('');

    // Mock existsSync for the repo path check
    const fs = require('node:fs');
    const originalExistsSync = fs.existsSync;
    fs.existsSync = (p: string) => {
      if (p === '/home/user/myrepo') return true;
      return originalExistsSync(p);
    };

    const svc = new StateService(git, tmux, registry);
    const state = await svc.collect();

    expect(state.repos).toEqual([['myrepo', '/home/user/myrepo']]);
    fs.existsSync = originalExistsSync;
  });

  it('does not auto-register repos from tmux sessions', async () => {
    const git = makeMockGit();
    const tmux = makeMockTmux();
    const registry = makeMockRegistry();
    vi.mocked(registry.load).mockReturnValue({});
    vi.mocked(tmux.listSessions).mockResolvedValue(['somerepo/main']);
    vi.mocked(tmux.listPanes).mockResolvedValue(null);

    const svc = new StateService(git, tmux, registry);
    const state = await svc.collect();

    // Session appears with parsed repo name
    expect(state.entries).toHaveLength(1);
    expect(state.entries[0].repo).toBe('somerepo');
    expect(state.entries[0].branch).toBe('main');

    // But registry.save was never called (no auto-discovery)
    expect(registry.save).not.toHaveBeenCalled();
  });

  it('parses standalone sessions correctly', async () => {
    const git = makeMockGit();
    const tmux = makeMockTmux();
    const registry = makeMockRegistry();
    vi.mocked(registry.load).mockReturnValue({});
    vi.mocked(tmux.listSessions).mockResolvedValue(['scratch']);

    const svc = new StateService(git, tmux, registry);
    const state = await svc.collect();

    expect(state.entries).toHaveLength(1);
    expect(state.entries[0].repo).toBe('standalone');
    expect(state.entries[0].branch).toBe('scratch');
    expect(state.entries[0].upstream).toBeNull();
  });

  it('processes last worktree entry when output lacks trailing newline', async () => {
    const git = makeMockGit();
    const tmux = makeMockTmux();
    const registry = makeMockRegistry();
    vi.mocked(registry.load).mockReturnValue({ myrepo: '/home/user/myrepo' });
    vi.mocked(git.getWorktreeDir).mockReturnValue('/home/user/myrepo/.worktrees');
    vi.mocked(git.worktreeListPorcelain).mockResolvedValue(
      'worktree /home/user/myrepo\nHEAD abc123\nbranch refs/heads/main'
    );

    const fs = require('node:fs');
    const originalExistsSync = fs.existsSync;
    fs.existsSync = (p: string) => {
      if (p === '/home/user/myrepo') return true;
      return originalExistsSync(p);
    };

    const svc = new StateService(git, tmux, registry);
    const state = await svc.collect();

    const mainEntry = state.entries.find((e) => e.isMainWorktree);
    expect(mainEntry).toBeDefined();
    expect(mainEntry!.branch).toBe('main');
    expect(mainEntry!.worktreePath).toBe('/home/user/myrepo');
    fs.existsSync = originalExistsSync;
  });

  it('sets upstream from git tracking info', async () => {
    const git = makeMockGit();
    const tmux = makeMockTmux();
    const registry = makeMockRegistry();
    vi.mocked(registry.load).mockReturnValue({ myrepo: '/home/user/myrepo' });
    vi.mocked(git.getWorktreeDir).mockReturnValue('/home/user/myrepo/.worktrees');
    vi.mocked(git.getUpstreams).mockResolvedValue(new Map([
      ['main', 'origin/main'],
      ['feat', 'origin/main'],
    ]));
    vi.mocked(git.worktreeListPorcelain).mockResolvedValue(
      'worktree /home/user/myrepo\nHEAD abc\nbranch refs/heads/main'
    );
    vi.mocked(tmux.listSessions).mockResolvedValue(['myrepo/feat']);
    vi.mocked(tmux.listPanes).mockResolvedValue(null);

    const fs = require('node:fs');
    const originalExistsSync = fs.existsSync;
    fs.existsSync = (p: string) => {
      if (p === '/home/user/myrepo') return true;
      return originalExistsSync(p);
    };

    const svc = new StateService(git, tmux, registry);
    const state = await svc.collect();

    // Tmux-only entry gets upstream from git
    const tmuxEntry = state.entries.find((e) => e.tmuxSession === 'myrepo/feat');
    expect(tmuxEntry!.upstream).toBe('origin/main');

    // Orphan worktree entry also gets upstream
    const mainEntry = state.entries.find((e) => e.isMainWorktree);
    expect(mainEntry!.upstream).toBe('origin/main');
    fs.existsSync = originalExistsSync;
  });

  it('sets upstream to null when branch has no tracking info', async () => {
    const git = makeMockGit();
    const tmux = makeMockTmux();
    const registry = makeMockRegistry();
    vi.mocked(registry.load).mockReturnValue({ myrepo: '/home/user/myrepo' });
    vi.mocked(git.getWorktreeDir).mockReturnValue('/home/user/myrepo/.worktrees');
    vi.mocked(git.getUpstreams).mockResolvedValue(new Map()); // no upstreams
    vi.mocked(git.worktreeListPorcelain).mockResolvedValue(
      'worktree /home/user/myrepo\nHEAD abc\nbranch refs/heads/main'
    );

    const fs = require('node:fs');
    const originalExistsSync = fs.existsSync;
    fs.existsSync = (p: string) => {
      if (p === '/home/user/myrepo') return true;
      return originalExistsSync(p);
    };

    const svc = new StateService(git, tmux, registry);
    const state = await svc.collect();

    const mainEntry = state.entries.find((e) => e.isMainWorktree);
    expect(mainEntry!.upstream).toBeNull();
    fs.existsSync = originalExistsSync;
  });
});
