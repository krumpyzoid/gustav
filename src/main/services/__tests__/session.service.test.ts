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

describe('SessionService.launchSession', () => {
  it('creates a tmux session with the first window as the initial window', async () => {
    const tmux = makeMockTmux();
    const svc = new SessionService(tmux);

    await svc.launchSession('Dev/api/_dir', '/home/user/api', [
      { name: 'Claude Code', kind: 'claude' },
      { name: 'Shell', kind: 'command' },
    ]);

    expect(tmux.newSession).toHaveBeenCalledWith('Dev/api/_dir', {
      windowName: 'Claude Code',
      cwd: '/home/user/api',
    });
    expect(tmux.sendKeys).toHaveBeenCalledWith('Dev/api/_dir:Claude Code', 'claude');
    expect(tmux.newWindow).toHaveBeenCalledWith('Dev/api/_dir', 'Shell', '/home/user/api');
    expect(tmux.selectWindow).toHaveBeenCalledWith('Dev/api/_dir', 'Claude Code');
  });

  it('attaches --resume <id> to the claude tab when claudeSessionId is set', async () => {
    const tmux = makeMockTmux();
    const svc = new SessionService(tmux);

    await svc.launchSession('Dev/api/_dir', '/home/user/api', [
      { name: 'Claude Code', kind: 'claude', claudeSessionId: 'abc-123' },
      { name: 'Shell', kind: 'command' },
    ]);

    expect(tmux.sendKeys).toHaveBeenCalledWith('Dev/api/_dir:Claude Code', 'claude --resume abc-123');
  });

  it('runs commands for kind:command tabs and skips empty shells', async () => {
    const tmux = makeMockTmux();
    const svc = new SessionService(tmux);

    await svc.launchSession('Dev/_ws', '/home/user/dev', [
      { name: 'Git', kind: 'command', command: 'lazygit' },
      { name: 'Shell', kind: 'command' },
      { name: 'Tests', kind: 'command', command: 'npm test' },
    ]);

    expect(tmux.sendKeys).toHaveBeenCalledWith('Dev/_ws:Git', 'lazygit');
    expect(tmux.sendKeys).toHaveBeenCalledWith('Dev/_ws:Tests', 'npm test');
    const sendKeysCalls = vi.mocked(tmux.sendKeys).mock.calls;
    expect(sendKeysCalls.some(([target]) => target === 'Dev/_ws:Shell')).toBe(false);
  });

  it('returns existing session name without re-creating when tmux already has it', async () => {
    const tmux = makeMockTmux();
    vi.mocked(tmux.hasSession).mockResolvedValue(true);
    const svc = new SessionService(tmux);

    const result = await svc.launchSession('existing/session', '/tmp', [
      { name: 'A', kind: 'command' },
    ]);

    expect(result).toBe('existing/session');
    expect(tmux.newSession).not.toHaveBeenCalled();
  });

  it('throws when called with no windows', async () => {
    const tmux = makeMockTmux();
    const svc = new SessionService(tmux);

    await expect(svc.launchSession('empty/session', '/tmp', [])).rejects.toThrow();
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
      windows: [
        { name: 'Claude Code', kind: 'claude' },
        { name: 'Git', kind: 'command', command: 'lazygit' },
        { name: 'Shell', kind: 'command' },
      ],
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
      windows: [
        { name: 'Claude Code', kind: 'claude' },
        { name: 'Shell', kind: 'command' },
      ],
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
        { name: 'Claude Code', kind: 'claude' },
        { name: 'Git', kind: 'command', command: 'lazygit' },
        { name: 'Shell', kind: 'command' },
      ] satisfies WindowSpec[],
    });

    expect(tmux.sendKeys).toHaveBeenCalledWith('Dev/api/_dir:Claude Code', 'claude');
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
        { name: 'Claude Code', kind: 'claude', claudeSessionId: 'abc-123' },
        { name: 'Shell', kind: 'command' },
      ] satisfies WindowSpec[],
    });

    expect(tmux.sendKeys).toHaveBeenCalledWith('Dev/api/_dir:Claude Code', 'claude --resume abc-123');
  });

  it('sends custom command-kind window commands', async () => {
    const tmux = makeMockTmux();
    vi.mocked(tmux.hasSession).mockResolvedValue(false);
    const svc = new SessionService(tmux);

    await svc.restoreSession({
      tmuxSession: 'Dev/api/_dir',
      type: 'directory',
      directory: '/home/user/api',
      windows: [
        { name: 'Claude Code', kind: 'claude' },
        { name: 'Dev', kind: 'command', command: 'pnpm run dev' },
        { name: 'Shell', kind: 'command' },
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
          {
            tmuxSession: 'Dev/_ws',
            type: 'workspace',
            directory: '/home/user/dev',
            windows: [
              { name: 'Claude Code', kind: 'claude' },
              { name: 'Shell', kind: 'command' },
            ],
          },
          {
            tmuxSession: 'Dev/api/_dir',
            type: 'directory',
            directory: '/home/user/dev/api',
            windows: [
              { name: 'Claude Code', kind: 'claude' },
              { name: 'Git', kind: 'command', command: 'lazygit' },
              { name: 'Shell', kind: 'command' },
            ],
          },
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
  // ── kind: 'claude' ──
  it('claude kind with id returns "claude --resume <id>"', () => {
    const spec: WindowSpec = { name: 'Claude Code', kind: 'claude', claudeSessionId: 'abc' };
    expect(buildRestoreCommand(spec)).toBe('claude --resume abc');
  });

  it('claude kind without id returns bare "claude"', () => {
    const spec: WindowSpec = { name: 'Claude Code', kind: 'claude' };
    expect(buildRestoreCommand(spec)).toBe('claude');
  });

  it('claude kind with args and id resumes with both flags', () => {
    const spec: WindowSpec = {
      name: 'Claude Code',
      kind: 'claude',
      args: '--dangerously-skip-permissions',
      claudeSessionId: 'abc',
    };
    expect(buildRestoreCommand(spec)).toBe('claude --dangerously-skip-permissions --resume abc');
  });

  it('claude kind with args and no id passes args through', () => {
    const spec: WindowSpec = {
      name: 'Claude Code',
      kind: 'claude',
      args: '--dangerously-skip-permissions',
    };
    expect(buildRestoreCommand(spec)).toBe('claude --dangerously-skip-permissions');
  });

  it('claude kind strips user-supplied --resume when no id', () => {
    const spec: WindowSpec = { name: 'Claude Code', kind: 'claude', args: '--resume bogus' };
    expect(buildRestoreCommand(spec)).toBe('claude');
  });

  // ── kind: 'command' ──
  it('command kind with command returns the command', () => {
    const spec: WindowSpec = { name: 'Git', kind: 'command', command: 'lazygit' };
    expect(buildRestoreCommand(spec)).toBe('lazygit');
  });

  it('command kind without command returns undefined (shell)', () => {
    const spec: WindowSpec = { name: 'Shell', kind: 'command' };
    expect(buildRestoreCommand(spec)).toBeUndefined();
  });

  it('returns custom commands as-is for kind:command tabs', () => {
    const spec: WindowSpec = { name: 'Tests', kind: 'command', command: 'npm test' };
    expect(buildRestoreCommand(spec)).toBe('npm test');
  });
});
