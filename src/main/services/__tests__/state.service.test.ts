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
  });
});
