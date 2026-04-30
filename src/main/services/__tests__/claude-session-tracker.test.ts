import { describe, it, expect, vi } from 'vitest';
import { ClaudeSessionTracker } from '../claude-session-tracker';
import type { TmuxPort, PaneInfo } from '../../ports/tmux.port';
import type { ShellPort } from '../../ports/shell.port';
import type { FileSystemPort } from '../../ports/filesystem.port';
import type { WorkspaceService } from '../workspace.service';
import type { Workspace } from '../../domain/types';

function makeMockTmux(): TmuxPort {
  return {
    listPanesExtended: vi.fn().mockResolvedValue([]),
    exec: vi.fn(),
    listSessions: vi.fn(),
    hasSession: vi.fn(),
    newSession: vi.fn(),
    killSession: vi.fn(),
    switchClient: vi.fn(),
    newWindow: vi.fn(),
    sendKeys: vi.fn(),
    selectWindow: vi.fn(),
    killWindow: vi.fn(),
    listPanes: vi.fn(),
    capturePaneContent: vi.fn(),
    displayMessage: vi.fn(),
    listWindows: vi.fn(),
    listClients: vi.fn(),
  } as unknown as TmuxPort;
}

function makeMockShell(): ShellPort {
  return {
    exec: vi.fn().mockResolvedValue(''),
    execFile: vi.fn().mockResolvedValue(''),
    execSync: vi.fn().mockReturnValue(''),
  };
}

function makeMockFs(): FileSystemPort {
  return {
    readFile: vi.fn().mockRejectedValue(new Error('not found')),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
    exists: vi.fn(),
    copyFile: vi.fn(),
    copyRecursive: vi.fn(),
    readlink: vi.fn(),
    watch: vi.fn(),
  } as unknown as FileSystemPort;
}

function makeMockWorkspaceService(): WorkspaceService {
  return {
    list: vi.fn().mockReturnValue([]),
    persistSession: vi.fn().mockResolvedValue(undefined),
    getPersistedSessions: vi.fn().mockReturnValue([]),
    findBySessionPrefix: vi.fn(),
    create: vi.fn(),
    rename: vi.fn(),
    remove: vi.fn(),
    updateOrdering: vi.fn(),
    reorder: vi.fn(),
    pinRepos: vi.fn(),
    unpinRepo: vi.fn(),
    removeSession: vi.fn(),
    findByDirectory: vi.fn(),
    discoverGitRepos: vi.fn(),
  } as unknown as WorkspaceService;
}

describe('ClaudeSessionTracker', () => {
  it('captures Claude session ID from pane', async () => {
    const tmux = makeMockTmux();
    const shell = makeMockShell();
    const fs = makeMockFs();
    const workspaceService = makeMockWorkspaceService();

    const workspace: Workspace = {
      id: 'ws1',
      name: 'Dev',
      directory: '/home/user/dev',
      sessions: [
        {
          tmuxSession: 'Dev/api/_dir',
          type: 'directory',
          directory: '/home/user/dev/api',
          windows: [
            { name: 'Claude Code', kind: 'claude' },
            { name: 'Shell', kind: 'command' },
          ],
        },
      ],
    };

    const pane: PaneInfo = { paneId: '%0', windowName: 'Claude Code', paneCommand: 'claude', panePid: 1000, paneCwd: '/home/user' };
    vi.mocked(tmux.listPanesExtended).mockResolvedValue([pane]);
    vi.mocked(shell.exec).mockResolvedValue('2000');
    vi.mocked(fs.readFile).mockImplementation(async (path: string) => {
      if (path.includes('2000.json')) return JSON.stringify({ pid: 2000, sessionId: 'uuid-abc' });
      throw new Error('not found');
    });

    const tracker = new ClaudeSessionTracker(tmux, shell, fs, workspaceService);
    const changed = await tracker.captureAll([workspace]);

    expect(changed).toBe(true);
    expect(workspaceService.persistSession).toHaveBeenCalledOnce();

    const [calledId, calledSession] = vi.mocked(workspaceService.persistSession).mock.calls[0]!;
    expect(calledId).toBe('ws1');
    const claudeWindow = calledSession.windows.find(
      (w) => typeof w === 'object' && w.name === 'Claude Code',
    ) as { name: string; claudeSessionId?: string } | undefined;
    expect(claudeWindow?.claudeSessionId).toBe('uuid-abc');
  });

  it('returns false when session ID is already captured and unchanged', async () => {
    const tmux = makeMockTmux();
    const shell = makeMockShell();
    const fs = makeMockFs();
    const workspaceService = makeMockWorkspaceService();

    const workspace: Workspace = {
      id: 'ws1',
      name: 'Dev',
      directory: '/home/user/dev',
      sessions: [
        {
          tmuxSession: 'Dev/api/_dir',
          type: 'directory',
          directory: '/home/user/dev/api',
          // Window already has the session ID captured
          windows: [{ name: 'Claude Code', kind: 'claude', claudeSessionId: 'uuid-abc' }],
        },
      ],
    };

    const pane: PaneInfo = { paneId: '%0', windowName: 'Claude Code', paneCommand: 'claude', panePid: 1000, paneCwd: '/home/user' };
    vi.mocked(tmux.listPanesExtended).mockResolvedValue([pane]);
    vi.mocked(shell.exec).mockResolvedValue('2000');
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ pid: 2000, sessionId: 'uuid-abc' }));

    const tracker = new ClaudeSessionTracker(tmux, shell, fs, workspaceService);
    const changed = await tracker.captureAll([workspace]);

    expect(changed).toBe(false);
    expect(workspaceService.persistSession).not.toHaveBeenCalled();
  });

  it('promotes a Shell window to kind:claude when Claude runs in it', async () => {
    const tmux = makeMockTmux();
    const shell = makeMockShell();
    const fs = makeMockFs();
    const workspaceService = makeMockWorkspaceService();

    const workspace: Workspace = {
      id: 'ws1',
      name: 'Dev',
      directory: '/home/user/dev',
      sessions: [
        {
          tmuxSession: 'Dev/api/_dir',
          type: 'directory',
          directory: '/home/user/dev/api',
          windows: [{ name: 'Shell', kind: 'command' }],
        },
      ],
    };

    const pane: PaneInfo = { paneId: '%0', windowName: 'Shell', paneCommand: 'claude', panePid: 1000, paneCwd: '/home/user' };
    vi.mocked(tmux.listPanesExtended).mockResolvedValue([pane]);
    vi.mocked(shell.exec).mockResolvedValue('2000');
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ pid: 2000, sessionId: 'uuid-xyz' }));

    const tracker = new ClaudeSessionTracker(tmux, shell, fs, workspaceService);
    const changed = await tracker.captureAll([workspace]);

    expect(changed).toBe(true);
    expect(workspaceService.persistSession).toHaveBeenCalledOnce();

    const [, calledSession] = vi.mocked(workspaceService.persistSession).mock.calls[0]!;
    const shellWindow = calledSession.windows.find((w) => w.name === 'Shell');
    expect(shellWindow?.kind).toBe('claude');
    expect(shellWindow?.claudeSessionId).toBe('uuid-xyz');
  });

  it('handles missing session file gracefully', async () => {
    const tmux = makeMockTmux();
    const shell = makeMockShell();
    const fs = makeMockFs();
    const workspaceService = makeMockWorkspaceService();

    const workspace: Workspace = {
      id: 'ws1',
      name: 'Dev',
      directory: '/home/user/dev',
      sessions: [
        {
          tmuxSession: 'Dev/api/_dir',
          type: 'directory',
          directory: '/home/user/dev/api',
          windows: [{ name: 'Claude Code', kind: 'claude' }],
        },
      ],
    };

    const pane: PaneInfo = { paneId: '%0', windowName: 'Claude Code', paneCommand: 'claude', panePid: 1000, paneCwd: '/home/user' };
    vi.mocked(tmux.listPanesExtended).mockResolvedValue([pane]);
    vi.mocked(shell.exec).mockResolvedValue('2000');
    // readFile always rejects (session file missing)
    vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT: no such file or directory'));

    const tracker = new ClaudeSessionTracker(tmux, shell, fs, workspaceService);

    await expect(tracker.captureAll([workspace])).resolves.toBe(false);
    expect(workspaceService.persistSession).not.toHaveBeenCalled();
  });

  it('handles pgrep returning no children', async () => {
    const tmux = makeMockTmux();
    const shell = makeMockShell();
    const fs = makeMockFs();
    const workspaceService = makeMockWorkspaceService();

    const workspace: Workspace = {
      id: 'ws1',
      name: 'Dev',
      directory: '/home/user/dev',
      sessions: [
        {
          tmuxSession: 'Dev/api/_dir',
          type: 'directory',
          directory: '/home/user/dev/api',
          windows: [{ name: 'Claude Code', kind: 'claude' }],
        },
      ],
    };

    const pane: PaneInfo = { paneId: '%0', windowName: 'Claude Code', paneCommand: 'claude', panePid: 1000, paneCwd: '/home/user' };
    vi.mocked(tmux.listPanesExtended).mockResolvedValue([pane]);
    // pgrep throws when no matching processes are found
    vi.mocked(shell.exec).mockRejectedValue(new Error('pgrep: no matching processes'));

    const tracker = new ClaudeSessionTracker(tmux, shell, fs, workspaceService);

    await expect(tracker.captureAll([workspace])).resolves.toBe(false);
    expect(workspaceService.persistSession).not.toHaveBeenCalled();
  });

  it('skips sessions not in tmux', async () => {
    const tmux = makeMockTmux();
    const shell = makeMockShell();
    const fs = makeMockFs();
    const workspaceService = makeMockWorkspaceService();

    const workspace: Workspace = {
      id: 'ws1',
      name: 'Dev',
      directory: '/home/user/dev',
      sessions: [
        {
          tmuxSession: 'Dev/api/_dir',
          type: 'directory',
          directory: '/home/user/dev/api',
          windows: [{ name: 'Claude Code', kind: 'claude' }],
        },
      ],
    };

    // listPanesExtended throws because the tmux session doesn't exist
    vi.mocked(tmux.listPanesExtended).mockRejectedValue(new Error("can't find session: Dev/api/_dir"));

    const tracker = new ClaudeSessionTracker(tmux, shell, fs, workspaceService);

    await expect(tracker.captureAll([workspace])).resolves.toBe(false);
    expect(workspaceService.persistSession).not.toHaveBeenCalled();
  });
});
