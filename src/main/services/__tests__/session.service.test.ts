import { describe, it, expect, vi } from 'vitest';
import { SessionService, buildRestoreCommand } from '../session.service';
import type { TmuxPort } from '../../ports/tmux.port';
import type { Workspace, WindowSpec } from '../../domain/types';

function makeMockTmux(): TmuxPort {
  return {
    exec: vi.fn().mockResolvedValue(''),
    listSessions: vi.fn().mockResolvedValue([]),
    hasSession: vi.fn().mockResolvedValue(false),
    newSession: vi.fn().mockResolvedValue(undefined),
    killSession: vi.fn().mockResolvedValue(undefined),
    switchClient: vi.fn().mockResolvedValue(undefined),
    newWindow: vi.fn().mockResolvedValue(undefined),
    sendKeys: vi.fn().mockResolvedValue(undefined),
    selectWindow: vi.fn().mockResolvedValue(undefined),
    killWindow: vi.fn().mockResolvedValue(undefined),
    listPanes: vi.fn().mockResolvedValue(''),
    capturePaneContent: vi.fn().mockResolvedValue(''),
    displayMessage: vi.fn().mockResolvedValue(''),
    listWindows: vi.fn().mockResolvedValue([]),
    listClients: vi.fn().mockResolvedValue([]),
  };
}

const emptyConfig = {
  env: {},
  copy: [],
  install: '',
  base: '',
  hooks: {},
  tmux: [],
  cleanMergedInto: 'origin/staging',
};

describe('SessionService naming', () => {
  it('names workspace sessions as workspaceName/_ws', () => {
    const svc = new SessionService(makeMockTmux());
    expect(svc.getSessionName('myproject', { type: 'workspace' })).toBe('myproject/_ws');
  });

  it('names directory sessions as workspaceName/repoName/_dir', () => {
    const svc = new SessionService(makeMockTmux());
    expect(svc.getSessionName('myproject', { type: 'directory', repoName: 'api' })).toBe(
      'myproject/api/_dir',
    );
  });

  it('names worktree sessions as workspaceName/repoName/branch', () => {
    const svc = new SessionService(makeMockTmux());
    expect(
      svc.getSessionName('myproject', { type: 'worktree', repoName: 'api', branch: 'feat-auth' }),
    ).toBe('myproject/api/feat-auth');
  });

  it('names standalone sessions as _standalone/label', () => {
    const svc = new SessionService(makeMockTmux());
    expect(svc.getSessionName(null, { type: 'workspace', label: 'scratch' })).toBe(
      '_standalone/scratch',
    );
  });
});

describe('SessionService.launchWorkspaceSession', () => {
  it('creates session with claude and shell windows', async () => {
    const tmux = makeMockTmux();
    const svc = new SessionService(tmux);

    await svc.launchWorkspaceSession('myproject', '/home/user/myproject', emptyConfig);

    expect(tmux.newSession).toHaveBeenCalledWith('myproject/_ws', {
      windowName: 'Claude Code',
      cwd: '/home/user/myproject',
    });
    expect(tmux.sendKeys).toHaveBeenCalledWith("myproject/_ws:Claude Code", 'claude');
    expect(tmux.newWindow).toHaveBeenCalledWith('myproject/_ws', 'Shell', '/home/user/myproject');
  });

  it('creates additional windows from .gustav config', async () => {
    const tmux = makeMockTmux();
    const svc = new SessionService(tmux);
    const config = { ...emptyConfig, tmux: ['Tests:npm test', 'Docs:npm run docs'] };

    await svc.launchWorkspaceSession('myproject', '/home/user/myproject', config);

    expect(tmux.newWindow).toHaveBeenCalledWith('myproject/_ws', 'Tests', '/home/user/myproject');
    expect(tmux.sendKeys).toHaveBeenCalledWith('myproject/_ws:Tests', 'npm test');
    expect(tmux.newWindow).toHaveBeenCalledWith('myproject/_ws', 'Docs', '/home/user/myproject');
    expect(tmux.sendKeys).toHaveBeenCalledWith('myproject/_ws:Docs', 'npm run docs');
  });

  it('does not create a Git window (unlike old repo sessions)', async () => {
    const tmux = makeMockTmux();
    const svc = new SessionService(tmux);

    await svc.launchWorkspaceSession('myproject', '/home/user/myproject', emptyConfig);

    const windowCalls = vi.mocked(tmux.newWindow).mock.calls;
    expect(windowCalls.some(([_, name]) => name === 'Git')).toBe(false);
  });
});

describe('SessionService.launchDirectorySession', () => {
  it('creates session with claude, git, and shell windows', async () => {
    const tmux = makeMockTmux();
    const svc = new SessionService(tmux);

    await svc.launchDirectorySession('myws', '/home/user/api', emptyConfig);

    const sessionName = 'myws/api/_dir';
    expect(tmux.newSession).toHaveBeenCalledWith(sessionName, {
      windowName: 'Claude Code',
      cwd: '/home/user/api',
    });
    expect(tmux.sendKeys).toHaveBeenCalledWith(`${sessionName}:Claude Code`, 'claude');
    expect(tmux.newWindow).toHaveBeenCalledWith(sessionName, 'Git', '/home/user/api');
    expect(tmux.sendKeys).toHaveBeenCalledWith(`${sessionName}:Git`, 'lazygit');
    expect(tmux.newWindow).toHaveBeenCalledWith(sessionName, 'Shell', '/home/user/api');
  });
});

describe('SessionService.launchWorktreeSession', () => {
  it('creates session with worktree naming', async () => {
    const tmux = makeMockTmux();
    const svc = new SessionService(tmux);

    await svc.launchWorktreeSession('myws', '/home/user/api', 'feat-auth', '/home/user/api/.worktrees/feat-auth', emptyConfig);

    const sessionName = 'myws/api/feat-auth';
    expect(tmux.newSession).toHaveBeenCalledWith(sessionName, {
      windowName: 'Claude Code',
      cwd: '/home/user/api/.worktrees/feat-auth',
    });
  });
});

describe('SessionService.launchStandaloneSession', () => {
  it('creates session with claude and shell only', async () => {
    const tmux = makeMockTmux();
    const svc = new SessionService(tmux);

    await svc.launchStandaloneSession('scratch', '/home/user/notes');

    expect(tmux.newSession).toHaveBeenCalledWith('_standalone/scratch', {
      windowName: 'Claude Code',
      cwd: '/home/user/notes',
    });
    expect(tmux.sendKeys).toHaveBeenCalledWith('_standalone/scratch:Claude Code', 'claude');
    expect(tmux.newWindow).toHaveBeenCalledWith('_standalone/scratch', 'Shell', '/home/user/notes');
  });
});

describe('SessionService.restoreSession', () => {
  it('creates tmux session with correct windows for a missing session', async () => {
    const tmux = makeMockTmux();
    vi.mocked(tmux.hasSession).mockResolvedValue(false);
    const svc = new SessionService(tmux);

    await svc.restoreSession({
      tmuxSession: 'Dev/api/_dir',
      type: 'directory',
      directory: '/home/user/api',
      windows: ['Claude Code', 'Git', 'Shell'],
    });

    expect(tmux.newSession).toHaveBeenCalledWith('Dev/api/_dir', {
      windowName: 'Claude Code',
      cwd: '/home/user/api',
    });
    expect(tmux.newWindow).toHaveBeenCalledWith('Dev/api/_dir', 'Git', '/home/user/api');
    expect(tmux.newWindow).toHaveBeenCalledWith('Dev/api/_dir', 'Shell', '/home/user/api');
  });

  it('skips session if it already exists in tmux', async () => {
    const tmux = makeMockTmux();
    vi.mocked(tmux.hasSession).mockResolvedValue(true);
    const svc = new SessionService(tmux);

    await svc.restoreSession({
      tmuxSession: 'Dev/api/_dir',
      type: 'directory',
      directory: '/home/user/api',
      windows: ['Claude Code', 'Git', 'Shell'],
    });

    expect(tmux.newSession).not.toHaveBeenCalled();
  });

  it('sends commands to restored windows with WindowSpec', async () => {
    const tmux = makeMockTmux();
    vi.mocked(tmux.hasSession).mockResolvedValue(false);
    const svc = new SessionService(tmux);

    await svc.restoreSession({
      tmuxSession: 'Dev/api/_dir',
      type: 'directory',
      directory: '/home/user/api',
      windows: [
        { name: 'Claude Code', command: 'claude' },
        { name: 'Git', command: 'lazygit' },
        { name: 'Shell' },
      ] satisfies WindowSpec[],
    });

    expect(tmux.sendKeys).toHaveBeenCalledWith('Dev/api/_dir:Claude Code', 'claude --continue');
    expect(tmux.sendKeys).toHaveBeenCalledWith('Dev/api/_dir:Git', 'lazygit');
    const sendKeysCalls = vi.mocked(tmux.sendKeys).mock.calls;
    expect(sendKeysCalls.some(([target]) => target === 'Dev/api/_dir:Shell')).toBe(false);
  });

  it('uses --resume when claudeSessionId is present', async () => {
    const tmux = makeMockTmux();
    vi.mocked(tmux.hasSession).mockResolvedValue(false);
    const svc = new SessionService(tmux);

    await svc.restoreSession({
      tmuxSession: 'Dev/api/_dir',
      type: 'directory',
      directory: '/home/user/api',
      windows: [
        { name: 'Claude Code', command: 'claude', claudeSessionId: 'abc-123' },
        { name: 'Shell' },
      ] satisfies WindowSpec[],
    });

    expect(tmux.sendKeys).toHaveBeenCalledWith('Dev/api/_dir:Claude Code', 'claude --resume abc-123');
  });

  it('sends no commands for legacy string[] windows', async () => {
    const tmux = makeMockTmux();
    vi.mocked(tmux.hasSession).mockResolvedValue(false);
    const svc = new SessionService(tmux);

    await svc.restoreSession({
      tmuxSession: 'Dev/api/_dir',
      type: 'directory',
      directory: '/home/user/api',
      windows: ['Claude Code', 'Git', 'Shell'],
    });

    expect(tmux.sendKeys).not.toHaveBeenCalled();
  });

  it('sends custom .gustav window commands', async () => {
    const tmux = makeMockTmux();
    vi.mocked(tmux.hasSession).mockResolvedValue(false);
    const svc = new SessionService(tmux);

    await svc.restoreSession({
      tmuxSession: 'Dev/api/_dir',
      type: 'directory',
      directory: '/home/user/api',
      windows: [
        { name: 'Claude Code', command: 'claude' },
        { name: 'Dev', command: 'pnpm run dev' },
        { name: 'Shell' },
      ] satisfies WindowSpec[],
    });

    expect(tmux.sendKeys).toHaveBeenCalledWith('Dev/api/_dir:Dev', 'pnpm run dev');
  });
});

describe('SessionService.restoreAll', () => {
  it('restores sessions from all workspaces', async () => {
    const tmux = makeMockTmux();
    vi.mocked(tmux.hasSession).mockResolvedValue(false);
    const svc = new SessionService(tmux);

    const workspaces: Workspace[] = [
      {
        id: 'ws1',
        name: 'Dev',
        directory: '/home/user/dev',
        sessions: [
          { tmuxSession: 'Dev/_ws', type: 'workspace', directory: '/home/user/dev', windows: ['Claude Code', 'Shell'] },
          { tmuxSession: 'Dev/api/_dir', type: 'directory', directory: '/home/user/dev/api', windows: ['Claude Code', 'Git', 'Shell'] },
        ],
      },
    ];

    await svc.restoreAll(workspaces);

    expect(tmux.newSession).toHaveBeenCalledTimes(2);
  });

  it('skips workspaces with no persisted sessions', async () => {
    const tmux = makeMockTmux();
    const svc = new SessionService(tmux);

    const workspaces: Workspace[] = [
      { id: 'ws1', name: 'Empty', directory: '/tmp' },
    ];

    await svc.restoreAll(workspaces);

    expect(tmux.newSession).not.toHaveBeenCalled();
  });
});

describe('buildRestoreCommand', () => {
  it('returns "claude --resume <id>" when command is "claude" and claudeSessionId is set', () => {
    const spec: WindowSpec = { name: 'Claude Code', command: 'claude', claudeSessionId: 'abc-123' };
    expect(buildRestoreCommand(spec)).toBe('claude --resume abc-123');
  });

  it('returns "claude --continue" when command is "claude" and no claudeSessionId', () => {
    const spec: WindowSpec = { name: 'Claude Code', command: 'claude' };
    expect(buildRestoreCommand(spec)).toBe('claude --continue');
  });

  it('returns the command as-is for non-claude commands (passthrough)', () => {
    const spec: WindowSpec = { name: 'Git', command: 'lazygit' };
    expect(buildRestoreCommand(spec)).toBe('lazygit');
  });

  it('returns undefined when command is undefined', () => {
    const spec: WindowSpec = { name: 'Shell' };
    expect(buildRestoreCommand(spec)).toBeUndefined();
  });

  it('returns custom .gustav commands as-is (passthrough)', () => {
    const spec: WindowSpec = { name: 'Tests', command: 'npm test' };
    expect(buildRestoreCommand(spec)).toBe('npm test');
  });
});
