import { describe, it, expect, vi } from 'vitest';
import { StateService, parseRawStatus } from '../state.service';
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
    listWindows: vi.fn().mockResolvedValue([]),
    listClients: vi.fn().mockResolvedValue([]),
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

  it('detects status independently per session (no cross-session leak)', async () => {
    const git = makeMockGit();
    const tmux = makeMockTmux();
    const registry = makeMockRegistry();
    vi.mocked(registry.load).mockReturnValue({});

    vi.mocked(tmux.listSessions).mockResolvedValue(['app/main', 'app/feat']);

    vi.mocked(tmux.listPanes).mockImplementation(async (session: string) => {
      if (session === 'app/main') return '%0\tClaude Code\tclaude';
      if (session === 'app/feat') return '%1\tClaude Code\tclaude';
      return '';
    });

    vi.mocked(tmux.capturePaneContent).mockImplementation(async (paneId: string) => {
      if (paneId === '%0') return '';
      if (paneId === '%1') return 'Do you want to allow this tool?\n(y = yes)';
      return '';
    });

    const svc = new StateService(git, tmux, registry);
    const state = await svc.collect();

    const mainEntry = state.entries.find((e) => e.tmuxSession === 'app/main');
    const featEntry = state.entries.find((e) => e.tmuxSession === 'app/feat');

    expect(mainEntry!.status).not.toBe(featEntry!.status);
    expect(featEntry!.status).toBe('action');
    expect(mainEntry!.status).toBe('new');
  });

  it('detects Claude pane even when pane_current_command is not claude', async () => {
    const git = makeMockGit();
    const tmux = makeMockTmux();
    const registry = makeMockRegistry();
    vi.mocked(registry.load).mockReturnValue({});
    vi.mocked(tmux.listSessions).mockResolvedValue(['app/main']);

    vi.mocked(tmux.listPanes).mockResolvedValue('%0\tClaude Code\tnode');
    vi.mocked(tmux.capturePaneContent).mockResolvedValue('Do you want to proceed?\n(y = yes)');

    const svc = new StateService(git, tmux, registry);
    const state = await svc.collect();

    const entry = state.entries.find((e) => e.tmuxSession === 'app/main');
    expect(entry!.status).not.toBe('none');
  });

  it('detects status for multiple sessions concurrently', async () => {
    const git = makeMockGit();
    const tmux = makeMockTmux();
    const registry = makeMockRegistry();
    vi.mocked(registry.load).mockReturnValue({});
    vi.mocked(tmux.listSessions).mockResolvedValue(['app/a', 'app/b', 'app/c']);

    vi.mocked(tmux.listPanes).mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 50));
      return '%0\tClaude Code\tclaude';
    });
    vi.mocked(tmux.capturePaneContent).mockResolvedValue('');

    const svc = new StateService(git, tmux, registry);
    const start = Date.now();
    await svc.collect();
    const elapsed = Date.now() - start;

    // If parallel: ~50ms. If sequential: ~150ms. Allow generous margin.
    expect(elapsed).toBeLessThan(120);
  });

  it('resolves $dir session branch dynamically from git', async () => {
    const git = makeMockGit();
    const tmux = makeMockTmux();
    const registry = makeMockRegistry();
    vi.mocked(registry.load).mockReturnValue({ myrepo: '/home/user/myrepo' });
    vi.mocked(git.getWorktreeDir).mockReturnValue('/home/user/myrepo/.worktrees');
    vi.mocked(git.getUpstreams).mockResolvedValue(new Map([['feat-x', 'origin/main']]));
    vi.mocked(git.worktreeListPorcelain).mockResolvedValue(
      'worktree /home/user/myrepo\nHEAD abc\nbranch refs/heads/feat-x\n'
    );
    // $dir session exists for this repo
    vi.mocked(tmux.listSessions).mockResolvedValue(['myrepo/$dir']);
    vi.mocked(tmux.listPanes).mockResolvedValue('%0\tClaude Code\tclaude');
    vi.mocked(tmux.capturePaneContent).mockResolvedValue('');

    const fs = require('node:fs');
    const originalExistsSync = fs.existsSync;
    fs.existsSync = (p: string) => {
      if (p === '/home/user/myrepo') return true;
      return originalExistsSync(p);
    };

    const svc = new StateService(git, tmux, registry);
    const state = await svc.collect();

    const dirEntry = state.entries.find((e) => e.tmuxSession === 'myrepo/$dir');
    expect(dirEntry).toBeDefined();
    expect(dirEntry!.branch).toBe('feat-x');
    expect(dirEntry!.isMainWorktree).toBe(true);
    expect(dirEntry!.worktreePath).toBe('/home/user/myrepo');
    expect(dirEntry!.upstream).toBe('origin/main');
    fs.existsSync = originalExistsSync;
  });

  it('updates $dir session branch when git checkout changes branch', async () => {
    const git = makeMockGit();
    const tmux = makeMockTmux();
    const registry = makeMockRegistry();
    vi.mocked(registry.load).mockReturnValue({ myrepo: '/home/user/myrepo' });
    vi.mocked(git.getWorktreeDir).mockReturnValue('/home/user/myrepo/.worktrees');
    vi.mocked(tmux.listSessions).mockResolvedValue(['myrepo/$dir']);
    vi.mocked(tmux.listPanes).mockResolvedValue('%0\tClaude Code\tclaude');
    vi.mocked(tmux.capturePaneContent).mockResolvedValue('');

    const fs = require('node:fs');
    const originalExistsSync = fs.existsSync;
    fs.existsSync = (p: string) => {
      if (p === '/home/user/myrepo') return true;
      return originalExistsSync(p);
    };

    const svc = new StateService(git, tmux, registry);

    // First poll: on main
    vi.mocked(git.getUpstreams).mockResolvedValue(new Map([['main', 'origin/main']]));
    vi.mocked(git.worktreeListPorcelain).mockResolvedValue(
      'worktree /home/user/myrepo\nHEAD abc\nbranch refs/heads/main\n'
    );
    const state1 = await svc.collect();
    expect(state1.entries.find((e) => e.tmuxSession === 'myrepo/$dir')!.branch).toBe('main');

    // Second poll: checked out feat
    vi.mocked(git.getUpstreams).mockResolvedValue(new Map([['feat', 'origin/feat']]));
    vi.mocked(git.worktreeListPorcelain).mockResolvedValue(
      'worktree /home/user/myrepo\nHEAD def\nbranch refs/heads/feat\n'
    );
    const state2 = await svc.collect();
    expect(state2.entries.find((e) => e.tmuxSession === 'myrepo/$dir')!.branch).toBe('feat');

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

  it('includes windows for the active session', async () => {
    const git = makeMockGit();
    const tmux = makeMockTmux();
    const registry = makeMockRegistry();
    vi.mocked(registry.load).mockReturnValue({});
    vi.mocked(tmux.listSessions).mockResolvedValue(['app/main']);
    vi.mocked(tmux.listPanes).mockResolvedValue('%0\tClaude Code\tclaude');
    vi.mocked(tmux.capturePaneContent).mockResolvedValue('');
    vi.mocked(tmux.listWindows).mockResolvedValue([
      { index: 0, name: 'Claude Code', active: true },
      { index: 1, name: 'Git', active: false },
      { index: 2, name: 'Shell', active: false },
    ]);

    const svc = new StateService(git, tmux, registry);
    const state = await svc.collect('app/main');

    expect(state.windows).toEqual([
      { index: 0, name: 'Claude Code', active: true },
      { index: 1, name: 'Git', active: false },
      { index: 2, name: 'Shell', active: false },
    ]);
  });

  it('returns empty windows when no active session is provided', async () => {
    const git = makeMockGit();
    const tmux = makeMockTmux();
    const registry = makeMockRegistry();
    vi.mocked(registry.load).mockReturnValue({});
    vi.mocked(tmux.listSessions).mockResolvedValue([]);

    const svc = new StateService(git, tmux, registry);
    const state = await svc.collect();

    expect(state.windows).toEqual([]);
  });
});

describe('parseRawStatus', () => {
  it('returns null for empty content', () => {
    expect(parseRawStatus('')).toBeNull();
  });

  it('returns null for whitespace-only content', () => {
    expect(parseRawStatus('   \n  \n  ')).toBeNull();
  });

  it('returns busy for spinner + ing…', () => {
    expect(parseRawStatus('Some output\n✻ Thinking…')).toBe('busy');
  });

  it('returns busy for various spinner symbols', () => {
    expect(parseRawStatus('✳ Hashing…')).toBe('busy');
    expect(parseRawStatus('✢ Stewing…')).toBe('busy');
    expect(parseRawStatus('· Accomplishing…')).toBe('busy');
  });

  it('does not match ing… without spinner at line start', () => {
    expect(parseRawStatus('  ⎿  Running…')).toBeNull();
    expect(parseRawStatus('Reading…')).toBeNull();
    expect(parseRawStatus('Some Thinking… happened')).toBeNull();
  });

  it('returns action for tool approval prompt with y=yes', () => {
    expect(parseRawStatus('Do you want to proceed?\n(y = yes)')).toBe('action');
  });

  it('returns action for Allow prompt', () => {
    expect(parseRawStatus('Some tool output\nAllow this action?')).toBe('action');
  });

  it('returns null when no patterns match', () => {
    expect(parseRawStatus('Some output from claude\n> waiting for input')).toBeNull();
  });

  it('strips chrome below ─── separator', () => {
    const pane = [
      '✻ Thinking…',
      '───────────',
      '❯ ',
      '───────────',
      '[Opus 4.6]',
    ].join('\n');
    expect(parseRawStatus(pane)).toBe('busy');
  });

  it('does not match ing… typed in the prompt box (below separator)', () => {
    const pane = [
      'Previous output',
      '───────────',
      '❯ I was thinking…',
      '───────────',
      '[Opus 4.6]',
    ].join('\n');
    expect(parseRawStatus(pane)).toBeNull();
  });

  it('matches action patterns in chrome area (approval prompts)', () => {
    const pane = [
      'Previous output',
      '───────────',
      'Allow this tool?',
      '(y = yes)',
      '───────────',
      '[Opus 4.6]',
    ].join('\n');
    expect(parseRawStatus(pane)).toBe('action');
  });

  it('returns null when only chrome is visible (idle)', () => {
    const pane = [
      'Here is the result',
      '───────────',
      '❯ ',
      '───────────',
      '[Opus 4.6]',
    ].join('\n');
    expect(parseRawStatus(pane)).toBeNull();
  });

  it('falls back to all lines when no separator exists', () => {
    expect(parseRawStatus('✻ Thinking…')).toBe('busy');
  });

  it('matches spinner+ing… only in the tail (last 30 content lines)', () => {
    const lines = Array.from({ length: 40 }, (_, i) => `line ${i}`);
    lines[0] = '✻ Thinking…';  // in head, not tail
    expect(parseRawStatus(lines.join('\n'))).toBeNull();
  });
});

describe('status state machine', () => {
  const chrome = '───────────\n❯ \n───────────\n[Opus 4.6]';

  it('returns new for a fresh session with no prior activity', async () => {
    const git = makeMockGit();
    const tmux = makeMockTmux();
    const registry = makeMockRegistry();
    vi.mocked(registry.load).mockReturnValue({});
    vi.mocked(tmux.listSessions).mockResolvedValue(['app/main']);
    vi.mocked(tmux.listPanes).mockResolvedValue('%0\tClaude Code\tclaude');
    vi.mocked(tmux.capturePaneContent).mockResolvedValue(`Welcome banner\n${chrome}`);

    const svc = new StateService(git, tmux, registry);
    const state = await svc.collect();

    expect(state.entries[0].status).toBe('new');
  });

  it('returns done after session was previously busy then idle', async () => {
    const git = makeMockGit();
    const tmux = makeMockTmux();
    const registry = makeMockRegistry();
    vi.mocked(registry.load).mockReturnValue({});
    vi.mocked(tmux.listSessions).mockResolvedValue(['app/main']);
    vi.mocked(tmux.listPanes).mockResolvedValue('%0\tClaude Code\tclaude');

    const svc = new StateService(git, tmux, registry);

    // First poll: busy
    vi.mocked(tmux.capturePaneContent).mockResolvedValue(`✻ Pondering…\n${chrome}`);
    const state1 = await svc.collect();
    expect(state1.entries[0].status).toBe('busy');

    // Second poll: no activity in content area → done (was dirty)
    vi.mocked(tmux.capturePaneContent).mockResolvedValue(`Here is the result\n${chrome}`);
    const state2 = await svc.collect();
    expect(state2.entries[0].status).toBe('done');
  });

  it('returns done after session was previously action then idle', async () => {
    const git = makeMockGit();
    const tmux = makeMockTmux();
    const registry = makeMockRegistry();
    vi.mocked(registry.load).mockReturnValue({});
    vi.mocked(tmux.listSessions).mockResolvedValue(['app/main']);
    vi.mocked(tmux.listPanes).mockResolvedValue('%0\tClaude Code\tclaude');

    const svc = new StateService(git, tmux, registry);

    // First poll: action (approval prompts are in content area above chrome)
    vi.mocked(tmux.capturePaneContent).mockResolvedValue(`Allow this tool?\n${chrome}`);
    const state1 = await svc.collect();
    expect(state1.entries[0].status).toBe('action');

    // Second poll: no pattern match → done
    vi.mocked(tmux.capturePaneContent).mockResolvedValue(`Tool ran successfully\n${chrome}`);
    const state2 = await svc.collect();
    expect(state2.entries[0].status).toBe('done');
  });

  it('cleans up dirty tracking when sessions are killed', async () => {
    const git = makeMockGit();
    const tmux = makeMockTmux();
    const registry = makeMockRegistry();
    vi.mocked(registry.load).mockReturnValue({});
    vi.mocked(tmux.listPanes).mockResolvedValue('%0\tClaude Code\tclaude');

    const svc = new StateService(git, tmux, registry);

    // Poll with busy session
    vi.mocked(tmux.listSessions).mockResolvedValue(['app/main']);
    vi.mocked(tmux.capturePaneContent).mockResolvedValue(`✻ Pondering…\n${chrome}`);
    await svc.collect();

    // Session killed, new session created
    vi.mocked(tmux.listSessions).mockResolvedValue(['app/feat']);
    vi.mocked(tmux.capturePaneContent).mockResolvedValue(`Welcome\n${chrome}`);
    const state = await svc.collect();

    // New session should be 'new', not 'done' from stale dirty tracking
    expect(state.entries[0].status).toBe('new');
  });
});
