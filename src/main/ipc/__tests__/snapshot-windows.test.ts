import { describe, it, expect, vi } from 'vitest';
import { snapshotSessionWindows } from '../snapshot-windows';
import type { TmuxPort } from '../../ports/tmux.port';
import type { ShellPort } from '../../ports/shell.port';

function makeMockTmux(
  windows: { index: number; name: string; active: boolean }[],
  panes: { paneId: string; windowName: string; paneCommand: string; panePid: number }[],
): TmuxPort {
  return {
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
    listPanesExtended: vi.fn().mockResolvedValue(panes),
    capturePaneContent: vi.fn(),
    displayMessage: vi.fn(),
    listWindows: vi.fn().mockResolvedValue(windows),
    listClients: vi.fn(),
  };
}

function makeMockShell(childCommands: Record<number, string> = {}): ShellPort {
  return {
    exec: vi.fn().mockImplementation(async (cmd: string) => {
      // pgrep -P <pid> → return child PID (pid + 1000 as convention)
      const pgrepMatch = cmd.match(/pgrep -P (\d+)/);
      if (pgrepMatch) {
        const parentPid = Number(pgrepMatch[1]);
        if (childCommands[parentPid] !== undefined) return String(parentPid + 1000);
        throw new Error('no children');
      }
      // ps -p <pid> -o args= → return full command
      const psMatch = cmd.match(/ps -p (\d+) -o args=/);
      if (psMatch) {
        const childPid = Number(psMatch[1]);
        const parentPid = childPid - 1000;
        if (childCommands[parentPid] !== undefined) return childCommands[parentPid];
        throw new Error('no such process');
      }
      return '';
    }),
    execSync: vi.fn().mockReturnValue(''),
  };
}

describe('snapshotSessionWindows', () => {
  it('preserves existing specs with known commands', async () => {
    const tmux = makeMockTmux(
      [
        { index: 0, name: 'Claude Code', active: true },
        { index: 1, name: 'Git', active: false },
        { index: 2, name: 'Shell', active: false },
      ],
      [
        { paneId: '%0', windowName: 'Claude Code', paneCommand: 'claude', panePid: 100 },
        { paneId: '%1', windowName: 'Git', paneCommand: 'lazygit', panePid: 101 },
        { paneId: '%2', windowName: 'Shell', paneCommand: 'zsh', panePid: 102 },
      ],
    );

    const existing = [
      { name: 'Claude Code', command: 'claude', claudeSessionId: 'abc-123' },
      { name: 'Git', command: 'lazygit' },
      { name: 'Shell' },
    ];

    const result = await snapshotSessionWindows(tmux, 'Dev/_ws', existing);

    expect(result).toEqual([
      { name: 'Claude Code', command: 'claude', claudeSessionId: 'abc-123' },
      { name: 'Git', command: 'lazygit' },
      { name: 'Shell' },
    ]);
  });

  it('captures non-shell TUI processes directly by process name', async () => {
    const tmux = makeMockTmux(
      [
        { index: 0, name: 'Claude Code', active: false },
        { index: 1, name: 'Logs', active: true },
      ],
      [
        { paneId: '%0', windowName: 'Claude Code', paneCommand: 'claude', panePid: 100 },
        { paneId: '%1', windowName: 'Logs', paneCommand: 'tail', panePid: 101 },
      ],
    );

    const existing = [{ name: 'Claude Code', command: 'claude' }];

    const result = await snapshotSessionWindows(tmux, 'Dev/_ws', existing);

    // 'tail' takes over the pane (non-shell), captured directly
    expect(result).toEqual([
      { name: 'Claude Code', command: 'claude' },
      { name: 'Logs', command: 'tail' },
    ]);
  });

  it('resolves full command from shell child process when ShellPort is provided', async () => {
    const tmux = makeMockTmux(
      [
        { index: 0, name: 'Claude Code', active: false },
        { index: 1, name: 'Shell', active: false },
        { index: 2, name: 'Dev Server', active: true },
      ],
      [
        { paneId: '%0', windowName: 'Claude Code', paneCommand: 'claude', panePid: 100 },
        { paneId: '%1', windowName: 'Shell', paneCommand: 'zsh', panePid: 101 },
        { paneId: '%2', windowName: 'Dev Server', paneCommand: 'zsh', panePid: 102 },
      ],
    );

    // Dev Server shell (PID 102) has a child running 'npm run dev'
    const shell = makeMockShell({ 102: 'npm run dev' });

    const existing = [
      { name: 'Claude Code', command: 'claude' },
      { name: 'Shell' },
      { name: 'Dev Server' },
    ];

    const result = await snapshotSessionWindows(tmux, 'Dev/_ws', existing, shell);

    expect(result).toEqual([
      { name: 'Claude Code', command: 'claude' },
      { name: 'Shell' },  // shell PID 101 has no child → no command
      { name: 'Dev Server', command: 'npm run dev' },
    ]);
  });

  it('strips absolute path prefix from resolved commands', async () => {
    const tmux = makeMockTmux(
      [{ index: 0, name: 'Dev', active: true }],
      [{ paneId: '%0', windowName: 'Dev', paneCommand: 'zsh', panePid: 200 }],
    );

    // ps returns full path: /usr/local/bin/npm run dev
    const shell = makeMockShell({ 200: '/usr/local/bin/npm run dev' });

    const result = await snapshotSessionWindows(tmux, 'Dev/_ws', [], shell);

    expect(result).toEqual([
      { name: 'Dev', command: 'npm run dev' },
    ]);
  });

  it('does not capture shell processes with no children as commands', async () => {
    const tmux = makeMockTmux(
      [
        { index: 0, name: 'Claude Code', active: false },
        { index: 1, name: 'Scratch', active: true },
      ],
      [
        { paneId: '%0', windowName: 'Claude Code', paneCommand: 'claude', panePid: 100 },
        { paneId: '%1', windowName: 'Scratch', paneCommand: 'bash', panePid: 101 },
      ],
    );

    // Shell PID 101 has no children
    const shell = makeMockShell({});

    const existing = [{ name: 'Claude Code', command: 'claude' }];

    const result = await snapshotSessionWindows(tmux, 'Dev/_ws', existing, shell);

    expect(result).toEqual([
      { name: 'Claude Code', command: 'claude' },
      { name: 'Scratch' },  // no command — just a shell prompt
    ]);
  });

  it('includes windows not in existing specs', async () => {
    const tmux = makeMockTmux(
      [
        { index: 0, name: 'Claude Code', active: false },
        { index: 1, name: 'Shell', active: false },
        { index: 2, name: 'Tests', active: true },
      ],
      [
        { paneId: '%0', windowName: 'Claude Code', paneCommand: 'claude', panePid: 100 },
        { paneId: '%1', windowName: 'Shell', paneCommand: 'zsh', panePid: 101 },
        { paneId: '%2', windowName: 'Tests', paneCommand: 'vitest', panePid: 102 },
      ],
    );

    const result = await snapshotSessionWindows(tmux, 'Dev/_ws', []);

    expect(result).toEqual([
      { name: 'Claude Code', command: 'claude' },
      { name: 'Shell' },
      { name: 'Tests', command: 'vitest' },
    ]);
  });

  it('drops windows that no longer exist in tmux', async () => {
    const tmux = makeMockTmux(
      [{ index: 0, name: 'Claude Code', active: true }],
      [{ paneId: '%0', windowName: 'Claude Code', paneCommand: 'claude', panePid: 100 }],
    );

    const existing = [
      { name: 'Claude Code', command: 'claude' },
      { name: 'Git', command: 'lazygit' },
      { name: 'Shell' },
    ];

    const result = await snapshotSessionWindows(tmux, 'Dev/_ws', existing);

    expect(result).toEqual([
      { name: 'Claude Code', command: 'claude' },
    ]);
  });

  it('handles legacy string[] window format', async () => {
    const tmux = makeMockTmux(
      [
        { index: 0, name: 'Claude Code', active: true },
        { index: 1, name: 'Shell', active: false },
      ],
      [
        { paneId: '%0', windowName: 'Claude Code', paneCommand: 'claude', panePid: 100 },
        { paneId: '%1', windowName: 'Shell', paneCommand: 'zsh', panePid: 101 },
      ],
    );

    const existing = ['Claude Code', 'Git', 'Shell'];

    const result = await snapshotSessionWindows(tmux, 'Dev/_ws', existing);

    expect(result).toEqual([
      { name: 'Claude Code', command: 'claude' },
      { name: 'Shell' },
    ]);
  });
});
