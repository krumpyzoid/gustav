import { describe, it, expect, vi } from 'vitest';
import { StateService, parseRawStatus } from '../state.service';
import type { GitPort } from '../../ports/git.port';
import type { TmuxPort } from '../../ports/tmux.port';
import type { WorkspaceService } from '../workspace.service';
import type { Workspace } from '../../domain/types';

function makeMockGit(): GitPort {
  return {
    getRepoRoot: vi.fn(),
    getCurrentBranch: vi.fn().mockResolvedValue('main'),
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
    displayMessage: vi.fn().mockResolvedValue(''),
    listPanes: vi.fn(),
    capturePaneContent: vi.fn(),
    sendKeys: vi.fn(),
    listWindows: vi.fn().mockResolvedValue([]),
    listClients: vi.fn().mockResolvedValue([]),
  } as unknown as TmuxPort;
}

function makeMockWorkspaceService(workspaces: Workspace[] = []): WorkspaceService {
  return {
    list: vi.fn().mockReturnValue(workspaces),
    create: vi.fn(),
    rename: vi.fn(),
    remove: vi.fn(),
    findByDirectory: vi.fn(),
    discoverGitRepos: vi.fn().mockReturnValue([]),
  } as unknown as WorkspaceService;
}

describe('StateService.collectWorkspaces', () => {
  it('groups sessions into workspace buckets by tmux name prefix', async () => {
    const git = makeMockGit();
    const tmux = makeMockTmux();
    const wsService = makeMockWorkspaceService([
      { id: 'ws1', name: 'My Project', directory: '/home/user/myproject', pinnedRepos: [{ path: '/home/user/myproject/api', repoName: 'api' }] },
    ]);

    vi.mocked(tmux.listSessions).mockResolvedValue([
      'My Project/_ws',
      'My Project/api/_dir',
    ]);
    vi.mocked(tmux.listPanes).mockResolvedValue('');

    const svc = new StateService(git, tmux, wsService);
    const state = await svc.collectWorkspaces();

    expect(state.workspaces).toHaveLength(1);
    expect(state.workspaces[0].workspace!.name).toBe('My Project');
    expect(state.workspaces[0].sessions).toHaveLength(1);
    expect(state.workspaces[0].sessions[0].type).toBe('workspace');
    expect(state.workspaces[0].repoGroups).toHaveLength(1);
    expect(state.workspaces[0].repoGroups[0].repoName).toBe('api');
  });

  it('puts standalone sessions in defaultWorkspace', async () => {
    const git = makeMockGit();
    const tmux = makeMockTmux();
    const wsService = makeMockWorkspaceService();

    vi.mocked(tmux.listSessions).mockResolvedValue(['_standalone/scratch']);
    vi.mocked(tmux.listPanes).mockResolvedValue('');

    const svc = new StateService(git, tmux, wsService);
    const state = await svc.collectWorkspaces();

    expect(state.defaultWorkspace.workspace).toBeNull();
    expect(state.defaultWorkspace.sessions).toHaveLength(1);
    expect(state.defaultWorkspace.sessions[0].tmuxSession).toBe('_standalone/scratch');
  });

  it('computes workspace status as worst across all child sessions', async () => {
    const git = makeMockGit();
    const tmux = makeMockTmux();
    const wsService = makeMockWorkspaceService([
      { id: 'ws1', name: 'Project', directory: '/home/user/proj', pinnedRepos: [{ path: '/home/user/proj/api', repoName: 'api' }] },
    ]);

    vi.mocked(tmux.listSessions).mockResolvedValue([
      'Project/_ws',
      'Project/api/_dir',
    ]);
    vi.mocked(tmux.listPanes).mockImplementation(async (session: string) => {
      if (session === 'Project/_ws') return '%0\tClaude Code\tclaude';
      if (session === 'Project/api/_dir') return '%1\tClaude Code\tclaude';
      return '';
    });
    vi.mocked(tmux.capturePaneContent).mockImplementation(async (paneId: string) => {
      if (paneId === '%0') return '';
      if (paneId === '%1') return 'Do you want?\n(y = yes)';
      return '';
    });

    const svc = new StateService(git, tmux, wsService);
    const state = await svc.collectWorkspaces();

    expect(state.workspaces[0].status).toBe('action');
  });

  it('parses worktree sessions into repo groups', async () => {
    const git = makeMockGit();
    const tmux = makeMockTmux();
    const wsService = makeMockWorkspaceService([
      { id: 'ws1', name: 'Work', directory: '/home/user/work', pinnedRepos: [{ path: '/home/user/work/api', repoName: 'api' }] },
    ]);

    vi.mocked(tmux.listSessions).mockResolvedValue([
      'Work/api/_dir',
      'Work/api/feat-auth',
    ]);
    vi.mocked(tmux.listPanes).mockResolvedValue('');

    const svc = new StateService(git, tmux, wsService);
    const state = await svc.collectWorkspaces();

    const repoGroup = state.workspaces[0].repoGroups[0];
    expect(repoGroup.repoName).toBe('api');
    expect(repoGroup.sessions).toHaveLength(2);
    const types = repoGroup.sessions.map((s) => s.type);
    expect(types).toContain('directory');
    expect(types).toContain('worktree');
  });

  it('returns empty state when no sessions or workspaces exist', async () => {
    const git = makeMockGit();
    const tmux = makeMockTmux();
    const wsService = makeMockWorkspaceService();

    const svc = new StateService(git, tmux, wsService);
    const state = await svc.collectWorkspaces();

    expect(state.defaultWorkspace.sessions).toEqual([]);
    expect(state.workspaces).toEqual([]);
  });

  it('detects claude by pane_current_command, not window name', async () => {
    const git = makeMockGit();
    const tmux = makeMockTmux();
    const wsService = makeMockWorkspaceService();

    vi.mocked(tmux.listSessions).mockResolvedValue(['_standalone/test']);
    vi.mocked(tmux.listPanes).mockResolvedValue('%0\tShell\tclaude');
    vi.mocked(tmux.capturePaneContent).mockResolvedValue('Do you want to proceed?\n(y = yes)');

    const svc = new StateService(git, tmux, wsService);
    const state = await svc.collectWorkspaces();

    expect(state.defaultWorkspace.sessions[0].status).toBe('action');
  });

  it('ignores panes not running claude command', async () => {
    const git = makeMockGit();
    const tmux = makeMockTmux();
    const wsService = makeMockWorkspaceService();

    vi.mocked(tmux.listSessions).mockResolvedValue(['_standalone/test']);
    vi.mocked(tmux.listPanes).mockResolvedValue('%0\tClaude Code\tnode');

    const svc = new StateService(git, tmux, wsService);
    const state = await svc.collectWorkspaces();

    expect(state.defaultWorkspace.sessions[0].status).toBe('none');
  });

  it('returns worst status across multiple claude panes', async () => {
    const git = makeMockGit();
    const tmux = makeMockTmux();
    const wsService = makeMockWorkspaceService();

    vi.mocked(tmux.listSessions).mockResolvedValue(['_standalone/test']);
    vi.mocked(tmux.listPanes).mockResolvedValue('%0\tClaude Code\tclaude\n%1\tShell\tclaude');
    vi.mocked(tmux.capturePaneContent).mockImplementation(async (paneId: string) => {
      if (paneId === '%0') return '✻ Thinking…';
      if (paneId === '%1') return 'Do you want to proceed?\n(y = yes)';
      return '';
    });

    const svc = new StateService(git, tmux, wsService);
    const state = await svc.collectWorkspaces();

    expect(state.defaultWorkspace.sessions[0].status).toBe('action');
  });

  it('detects status independently per session (no cross-session leak)', async () => {
    const git = makeMockGit();
    const tmux = makeMockTmux();
    const wsService = makeMockWorkspaceService([
      { id: 'ws1', name: 'app', directory: '/home/user/app', pinnedRepos: [{ path: '/home/user/app/api', repoName: 'api' }] },
    ]);

    vi.mocked(tmux.listSessions).mockResolvedValue(['app/api/_dir', 'app/api/feat']);

    vi.mocked(tmux.listPanes).mockImplementation(async (session: string) => {
      if (session === 'app/api/_dir') return '%0\tClaude Code\tclaude';
      if (session === 'app/api/feat') return '%1\tClaude Code\tclaude';
      return '';
    });

    vi.mocked(tmux.capturePaneContent).mockImplementation(async (paneId: string) => {
      if (paneId === '%0') return '';
      if (paneId === '%1') return 'Do you want to allow this tool?\n(y = yes)';
      return '';
    });

    const svc = new StateService(git, tmux, wsService);
    const state = await svc.collectWorkspaces();

    const sessions = state.workspaces[0].repoGroups[0].sessions;
    const dirSession = sessions.find((s) => s.type === 'directory');
    const featSession = sessions.find((s) => s.type === 'worktree');

    expect(dirSession!.status).toBe('new');
    expect(featSession!.status).toBe('action');
  });

  it('includes windows for the active session', async () => {
    const git = makeMockGit();
    const tmux = makeMockTmux();
    const wsService = makeMockWorkspaceService();
    vi.mocked(tmux.listSessions).mockResolvedValue([]);
    vi.mocked(tmux.listWindows).mockResolvedValue([
      { index: 0, name: 'Claude Code', active: true },
      { index: 1, name: 'Shell', active: false },
    ]);

    const svc = new StateService(git, tmux, wsService);
    const state = await svc.collectWorkspaces('some-session');

    expect(state.windows).toHaveLength(2);
  });

  it('returns empty windows when no active session', async () => {
    const git = makeMockGit();
    const tmux = makeMockTmux();
    const wsService = makeMockWorkspaceService();

    const svc = new StateService(git, tmux, wsService);
    const state = await svc.collectWorkspaces();

    expect(state.windows).toEqual([]);
  });

  it('applies persisted ordering to sessions, repos, and repo sessions', async () => {
    const git = makeMockGit();
    const tmux = makeMockTmux();
    const wsService = makeMockWorkspaceService([
      {
        id: 'ws1',
        name: 'Dev',
        directory: '/home/user/dev',
        pinnedRepos: [
          { path: '/home/user/dev/frontend', repoName: 'frontend' },
          { path: '/home/user/dev/api', repoName: 'api' },
        ],
        ordering: {
          sessions: ['Dev/debug', 'Dev/_ws'],
          repos: ['frontend', 'api'],
          repoSessions: { api: ['Dev/api/feat-auth', 'Dev/api/_dir'] },
        },
      },
    ]);

    vi.mocked(tmux.listSessions).mockResolvedValue([
      'Dev/_ws',
      'Dev/debug',
      'Dev/api/_dir',
      'Dev/api/feat-auth',
      'Dev/frontend/_dir',
    ]);
    vi.mocked(tmux.listPanes).mockResolvedValue('');

    const svc = new StateService(git, tmux, wsService);
    const state = await svc.collectWorkspaces();

    const ws = state.workspaces[0];
    // Workspace sessions ordered: debug before _ws
    expect(ws.sessions.map((s) => s.tmuxSession)).toEqual(['Dev/debug', 'Dev/_ws']);
    // Repo groups ordered: frontend before api
    expect(ws.repoGroups.map((rg) => rg.repoName)).toEqual(['frontend', 'api']);
    // Repo sessions ordered: feat-auth before _dir
    const apiGroup = ws.repoGroups.find((rg) => rg.repoName === 'api')!;
    expect(apiGroup.sessions.map((s) => s.tmuxSession)).toEqual(['Dev/api/feat-auth', 'Dev/api/_dir']);
  });

  it('appends items not in ordering at the end', async () => {
    const git = makeMockGit();
    const tmux = makeMockTmux();
    const wsService = makeMockWorkspaceService([
      {
        id: 'ws1',
        name: 'Dev',
        directory: '/home/user/dev',
        pinnedRepos: [
          { path: '/home/user/dev/api', repoName: 'api' },
          { path: '/home/user/dev/frontend', repoName: 'frontend' },
          { path: '/home/user/dev/shared', repoName: 'shared' },
        ],
        ordering: { repos: ['api'] },
      },
    ]);

    vi.mocked(tmux.listSessions).mockResolvedValue([
      'Dev/api/_dir',
      'Dev/frontend/_dir',
      'Dev/shared/_dir',
    ]);
    vi.mocked(tmux.listPanes).mockResolvedValue('');

    const svc = new StateService(git, tmux, wsService);
    const state = await svc.collectWorkspaces();

    const repos = state.workspaces[0].repoGroups.map((rg) => rg.repoName);
    expect(repos[0]).toBe('api');
    // frontend and shared not in ordering, appended in whatever order
    expect(repos).toContain('frontend');
    expect(repos).toContain('shared');
  });

  it('shows pinned repo with inactive directory session when none is running', async () => {
    const git = makeMockGit();
    const tmux = makeMockTmux();
    const wsService = makeMockWorkspaceService([
      {
        id: 'ws1',
        name: 'Dev',
        directory: '/home/user/dev',
        pinnedRepos: [{ path: '/home/user/dev/api', repoName: 'api' }],
      },
    ]);

    vi.mocked(tmux.listSessions).mockResolvedValue([]);
    vi.mocked(git.getCurrentBranch).mockResolvedValue('main');
    vi.mocked(git.listWorktrees).mockResolvedValue([]);

    const svc = new StateService(git, tmux, wsService);
    const state = await svc.collectWorkspaces();

    expect(state.workspaces[0].repoGroups).toHaveLength(1);
    const group = state.workspaces[0].repoGroups[0];
    expect(group.repoName).toBe('api');
    expect(group.repoRoot).toBe('/home/user/dev/api');
    expect(group.currentBranch).toBe('main');
    expect(group.sessions).toHaveLength(1);
    expect(group.sessions[0].type).toBe('directory');
    expect(group.sessions[0].active).toBe(false);
    expect(group.sessions[0].branch).toBe('main');
  });

  it('merges tmux sessions into pinned repo groups', async () => {
    const git = makeMockGit();
    const tmux = makeMockTmux();
    const wsService = makeMockWorkspaceService([
      {
        id: 'ws1',
        name: 'Dev',
        directory: '/home/user/dev',
        pinnedRepos: [{ path: '/home/user/dev/api', repoName: 'api' }],
      },
    ]);

    vi.mocked(tmux.listSessions).mockResolvedValue([
      'Dev/api/_dir',
      'Dev/api/feat-auth',
    ]);
    vi.mocked(tmux.listPanes).mockResolvedValue('');
    vi.mocked(git.getCurrentBranch).mockResolvedValue('main');
    vi.mocked(git.listWorktrees).mockResolvedValue([]);

    const svc = new StateService(git, tmux, wsService);
    const state = await svc.collectWorkspaces();

    const apiGroup = state.workspaces[0].repoGroups[0];
    expect(apiGroup.repoName).toBe('api');
    expect(apiGroup.currentBranch).toBe('main');
    expect(apiGroup.sessions).toHaveLength(2);
  });

  it('resolves currentBranch to null on git error', async () => {
    const git = makeMockGit();
    const tmux = makeMockTmux();
    const wsService = makeMockWorkspaceService([
      {
        id: 'ws1',
        name: 'Dev',
        directory: '/home/user/dev',
        pinnedRepos: [{ path: '/home/user/dev/api', repoName: 'api' }],
      },
    ]);

    vi.mocked(tmux.listSessions).mockResolvedValue([]);
    vi.mocked(git.getCurrentBranch).mockRejectedValue(new Error('not a git repo'));
    vi.mocked(git.listWorktrees).mockResolvedValue([]);

    const svc = new StateService(git, tmux, wsService);
    const state = await svc.collectWorkspaces();

    expect(state.workspaces[0].repoGroups[0].currentBranch).toBeNull();
  });

  it('does not show unpinned repos even with active sessions', async () => {
    const git = makeMockGit();
    const tmux = makeMockTmux();
    const wsService = makeMockWorkspaceService([
      {
        id: 'ws1',
        name: 'Dev',
        directory: '/home/user/dev',
        pinnedRepos: [{ path: '/home/user/dev/api', repoName: 'api' }],
      },
    ]);

    // 'web' has a session but is NOT pinned
    vi.mocked(tmux.listSessions).mockResolvedValue([
      'Dev/api/_dir',
      'Dev/web/_dir',
    ]);
    vi.mocked(tmux.listPanes).mockResolvedValue('');
    vi.mocked(git.getCurrentBranch).mockResolvedValue('main');
    vi.mocked(git.listWorktrees).mockResolvedValue([]);

    const svc = new StateService(git, tmux, wsService);
    const state = await svc.collectWorkspaces();

    const repoNames = state.workspaces[0].repoGroups.map((rg) => rg.repoName);
    expect(repoNames).toEqual(['api']);
    expect(repoNames).not.toContain('web');
  });

  it('discovers orphan worktrees for pinned repos', async () => {
    const git = makeMockGit();
    const tmux = makeMockTmux();
    const wsService = makeMockWorkspaceService([
      {
        id: 'ws1',
        name: 'Dev',
        directory: '/home/user/dev',
        pinnedRepos: [{ path: '/home/user/dev/api', repoName: 'api' }],
      },
    ]);

    vi.mocked(tmux.listSessions).mockResolvedValue([]);
    vi.mocked(tmux.listPanes).mockResolvedValue('');
    vi.mocked(git.getCurrentBranch).mockResolvedValue('main');
    vi.mocked(git.getWorktreeDir).mockReturnValue('/home/user/dev/api/.worktrees');
    vi.mocked(git.listWorktrees).mockResolvedValue([
      { path: '/home/user/dev/api/.worktrees/fix-bug', branch: 'fix-bug', head: 'abc123' },
    ]);

    const svc = new StateService(git, tmux, wsService);
    const state = await svc.collectWorkspaces();

    const apiGroup = state.workspaces[0].repoGroups[0];
    // Inactive directory session + orphan worktree
    expect(apiGroup.sessions).toHaveLength(2);
    expect(apiGroup.sessions[0].type).toBe('directory');
    expect(apiGroup.sessions[0].active).toBe(false);
    expect(apiGroup.sessions[1].branch).toBe('fix-bug');
    expect(apiGroup.sessions[1].active).toBe(false);
  });
});

describe('status state machine', () => {
  const chrome = '───────────\n❯ \n───────────\n[Opus 4.6]';

  it('returns new for a fresh session with no prior activity', async () => {
    const git = makeMockGit();
    const tmux = makeMockTmux();
    const wsService = makeMockWorkspaceService();
    vi.mocked(tmux.listSessions).mockResolvedValue(['_standalone/test']);
    vi.mocked(tmux.listPanes).mockResolvedValue('%0\tClaude Code\tclaude');
    vi.mocked(tmux.capturePaneContent).mockResolvedValue(`Welcome banner\n${chrome}`);

    const svc = new StateService(git, tmux, wsService);
    const state = await svc.collectWorkspaces();

    expect(state.defaultWorkspace.sessions[0].status).toBe('new');
  });

  it('returns done after session was previously busy then idle', async () => {
    const git = makeMockGit();
    const tmux = makeMockTmux();
    const wsService = makeMockWorkspaceService();
    vi.mocked(tmux.listSessions).mockResolvedValue(['_standalone/test']);
    vi.mocked(tmux.listPanes).mockResolvedValue('%0\tClaude Code\tclaude');

    const svc = new StateService(git, tmux, wsService);

    // First poll: busy
    vi.mocked(tmux.capturePaneContent).mockResolvedValue(`✻ Pondering…\n${chrome}`);
    const state1 = await svc.collectWorkspaces();
    expect(state1.defaultWorkspace.sessions[0].status).toBe('busy');

    // Second poll: no activity → done
    vi.mocked(tmux.capturePaneContent).mockResolvedValue(`Here is the result\n${chrome}`);
    const state2 = await svc.collectWorkspaces();
    expect(state2.defaultWorkspace.sessions[0].status).toBe('done');
  });

  it('returns done after session was previously action then idle', async () => {
    const git = makeMockGit();
    const tmux = makeMockTmux();
    const wsService = makeMockWorkspaceService();
    vi.mocked(tmux.listSessions).mockResolvedValue(['_standalone/test']);
    vi.mocked(tmux.listPanes).mockResolvedValue('%0\tClaude Code\tclaude');

    const svc = new StateService(git, tmux, wsService);

    vi.mocked(tmux.capturePaneContent).mockResolvedValue(`Allow this tool?\n${chrome}`);
    const state1 = await svc.collectWorkspaces();
    expect(state1.defaultWorkspace.sessions[0].status).toBe('action');

    vi.mocked(tmux.capturePaneContent).mockResolvedValue(`Tool ran successfully\n${chrome}`);
    const state2 = await svc.collectWorkspaces();
    expect(state2.defaultWorkspace.sessions[0].status).toBe('done');
  });

  it('cleans up dirty tracking when sessions are killed', async () => {
    const git = makeMockGit();
    const tmux = makeMockTmux();
    const wsService = makeMockWorkspaceService();
    vi.mocked(tmux.listPanes).mockResolvedValue('%0\tClaude Code\tclaude');

    const svc = new StateService(git, tmux, wsService);

    // Poll with busy session
    vi.mocked(tmux.listSessions).mockResolvedValue(['_standalone/a']);
    vi.mocked(tmux.capturePaneContent).mockResolvedValue(`✻ Pondering…\n${chrome}`);
    await svc.collectWorkspaces();

    // Session killed, new session created
    vi.mocked(tmux.listSessions).mockResolvedValue(['_standalone/b']);
    vi.mocked(tmux.capturePaneContent).mockResolvedValue(`Welcome\n${chrome}`);
    const state = await svc.collectWorkspaces();

    expect(state.defaultWorkspace.sessions[0].status).toBe('new');
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

  it('returns busy when words appear between the gerund and ellipsis', () => {
    expect(parseRawStatus('✻ Reading the file…')).toBe('busy');
    expect(parseRawStatus('✻ Editing 3 files…')).toBe('busy');
    expect(parseRawStatus('✻ Analyzing your code…')).toBe('busy');
  });

  it('does not match spinner lines without a gerund verb', () => {
    expect(parseRawStatus('✻ Read file…')).toBeNull();
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
    lines[0] = '✻ Thinking…';
    expect(parseRawStatus(lines.join('\n'))).toBeNull();
  });
});
