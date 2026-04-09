import { describe, it, expect, vi } from 'vitest';
import { SessionService } from '../session.service';
import type { TmuxPort } from '../../ports/tmux.port';

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
