import { describe, it, expect, vi } from 'vitest';
import { snapshotSessionWindows } from '../snapshot-windows';
import type { TmuxPort } from '../../ports/tmux.port';
import type { ShellPort } from '../../ports/shell.port';

function makeMockTmux(
  windows: { index: number; name: string; active: boolean }[],
  panes: { paneId: string; windowName: string; paneCommand: string; panePid: number; paneCwd?: string }[],
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
    listPanesExtended: vi.fn().mockResolvedValue(panes.map((p) => ({ ...p, paneCwd: p.paneCwd ?? '/home/user' }))),
    capturePaneContent: vi.fn(),
    displayMessage: vi.fn(),
    listWindows: vi.fn().mockResolvedValue(windows),
    listClients: vi.fn(),
  };
}

function makeMockShell(childCommands: Record<number, string> = {}): ShellPort {
  return {
    exec: vi.fn().mockImplementation(async (cmd: string) => {
      const pgrepMatch = cmd.match(/pgrep -P (\d+)/);
      if (pgrepMatch) {
        const parentPid = Number(pgrepMatch[1]);
        if (childCommands[parentPid] !== undefined) return String(parentPid + 1000);
        throw new Error('no children');
      }
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
  it('preserves claude spec but re-resolves other commands from live state', async () => {
    const tmux = makeMockTmux(
      [
        { index: 0, name: 'Claude Code', active: true },
        { index: 1, name: 'Git', active: false },
        { index: 2, name: 'Shell', active: false },
      ],
      [
        { paneId: '%0', windowName: 'Claude Code', paneCommand: 'claude', panePid: 100, paneCwd: '/home/user/api' },
        { paneId: '%1', windowName: 'Git', paneCommand: 'lazygit', panePid: 101, paneCwd: '/home/user/api' },
        { paneId: '%2', windowName: 'Shell', paneCommand: 'zsh', panePid: 102, paneCwd: '/home/user/api/src' },
      ],
    );

    const shell = makeMockShell({ 101: 'lazygit' });

    const existing = [
      { name: 'Claude Code', kind: 'claude' as const, claudeSessionId: 'abc-123' },
      { name: 'Git', kind: 'command' as const, command: 'lazygit' },
      { name: 'Shell', kind: 'command' as const },
    ];

    const result = await snapshotSessionWindows(tmux, 'Dev/_ws', existing, shell);

    expect(result).toEqual([
      { name: 'Claude Code', kind: 'claude', claudeSessionId: 'abc-123', directory: '/home/user/api' },
      { name: 'Git', kind: 'command', command: 'lazygit', directory: '/home/user/api' },
      { name: 'Shell', kind: 'command', directory: '/home/user/api/src' },
    ]);
  });

  it('overwrites stale commands with fresh resolution', async () => {
    const tmux = makeMockTmux(
      [{ index: 0, name: 'Dev Server', active: true }],
      [{ paneId: '%0', windowName: 'Dev Server', paneCommand: 'node', panePid: 200, paneCwd: '/home/user/app' }],
    );

    const shell = makeMockShell({ 200: 'pnpm run dev' });

    const existing = [{ name: 'Dev Server', kind: 'command' as const, command: 'node' }];

    const result = await snapshotSessionWindows(tmux, 'Dev/_ws', existing, shell);

    expect(result).toEqual([
      { name: 'Dev Server', kind: 'command', command: 'pnpm run dev', directory: '/home/user/app' },
    ]);
  });

  it('resolves full command via child process for pnpm/npm style commands', async () => {
    const tmux = makeMockTmux(
      [
        { index: 0, name: 'Claude Code', active: false },
        { index: 1, name: 'Dev Server', active: true },
      ],
      [
        { paneId: '%0', windowName: 'Claude Code', paneCommand: 'claude', panePid: 100 },
        { paneId: '%1', windowName: 'Dev Server', paneCommand: 'node', panePid: 101 },
      ],
    );

    const shell = makeMockShell({ 101: 'pnpm run dev' });

    const existing = [
      { name: 'Claude Code', kind: 'claude' as const },
      { name: 'Dev Server', kind: 'command' as const },
    ];

    const result = await snapshotSessionWindows(tmux, 'Dev/_ws', existing, shell);

    expect(result).toEqual([
      { name: 'Claude Code', kind: 'claude', directory: '/home/user' },
      { name: 'Dev Server', kind: 'command', command: 'pnpm run dev', directory: '/home/user' },
    ]);
  });

  it('resolves full command from shell child process', async () => {
    const tmux = makeMockTmux(
      [
        { index: 0, name: 'Shell', active: false },
        { index: 1, name: 'Dev Server', active: true },
      ],
      [
        { paneId: '%0', windowName: 'Shell', paneCommand: 'zsh', panePid: 101 },
        { paneId: '%1', windowName: 'Dev Server', paneCommand: 'zsh', panePid: 102 },
      ],
    );

    const shell = makeMockShell({ 102: 'npm run dev' });

    const result = await snapshotSessionWindows(
      tmux,
      'Dev/_ws',
      [{ name: 'Shell', kind: 'command' as const }, { name: 'Dev Server', kind: 'command' as const }],
      shell,
    );

    expect(result).toEqual([
      { name: 'Shell', kind: 'command', directory: '/home/user' },
      { name: 'Dev Server', kind: 'command', command: 'npm run dev', directory: '/home/user' },
    ]);
  });

  it('strips absolute path prefix from resolved commands', async () => {
    const tmux = makeMockTmux(
      [{ index: 0, name: 'Dev', active: true }],
      [{ paneId: '%0', windowName: 'Dev', paneCommand: 'zsh', panePid: 200 }],
    );

    const shell = makeMockShell({ 200: '/usr/local/bin/npm run dev' });

    const result = await snapshotSessionWindows(tmux, 'Dev/_ws', [], shell);

    expect(result).toEqual([
      { name: 'Dev', kind: 'command', command: 'npm run dev', directory: '/home/user' },
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

    const shell = makeMockShell({});

    const existing = [{ name: 'Claude Code', kind: 'claude' as const }];

    const result = await snapshotSessionWindows(tmux, 'Dev/_ws', existing, shell);

    expect(result).toEqual([
      { name: 'Claude Code', kind: 'claude', directory: '/home/user' },
      { name: 'Scratch', kind: 'command', directory: '/home/user' },
    ]);
  });

  it('falls back to process name without ShellPort', async () => {
    const tmux = makeMockTmux(
      [
        { index: 0, name: 'Logs', active: true },
        { index: 1, name: 'Prompt', active: false },
      ],
      [
        { paneId: '%0', windowName: 'Logs', paneCommand: 'tail', panePid: 100 },
        { paneId: '%1', windowName: 'Prompt', paneCommand: 'zsh', panePid: 101 },
      ],
    );

    const result = await snapshotSessionWindows(tmux, 'Dev/_ws', []);

    expect(result).toEqual([
      { name: 'Logs', kind: 'command', command: 'tail', directory: '/home/user' },
      { name: 'Prompt', kind: 'command', directory: '/home/user' },
    ]);
  });

  it('drops windows that no longer exist in tmux', async () => {
    const tmux = makeMockTmux(
      [{ index: 0, name: 'Claude Code', active: true }],
      [{ paneId: '%0', windowName: 'Claude Code', paneCommand: 'claude', panePid: 100 }],
    );

    const existing = [
      { name: 'Claude Code', kind: 'claude' as const },
      { name: 'Git', kind: 'command' as const, command: 'lazygit' },
      { name: 'Shell', kind: 'command' as const },
    ];

    const result = await snapshotSessionWindows(tmux, 'Dev/_ws', existing);

    expect(result).toEqual([
      { name: 'Claude Code', kind: 'claude', directory: '/home/user' },
    ]);
  });

  // ── Step 5 additions: kind/args inference ──

  it('infers kind:claude with args from a running claude command with flags', async () => {
    const tmux = makeMockTmux(
      [{ index: 0, name: 'Claude Code', active: true }],
      [{ paneId: '%0', windowName: 'Claude Code', paneCommand: 'claude', panePid: 100, paneCwd: '/home/user/api' }],
    );

    const shell = makeMockShell({ 100: 'claude --dangerously-skip-permissions' });

    const result = await snapshotSessionWindows(tmux, 'Dev/_ws', [], shell);

    expect(result).toEqual([
      {
        name: 'Claude Code',
        kind: 'claude',
        args: '--dangerously-skip-permissions',
        directory: '/home/user/api',
      },
    ]);
  });

  it('strips --resume token from inferred claude args', async () => {
    const tmux = makeMockTmux(
      [{ index: 0, name: 'Claude Code', active: true }],
      [{ paneId: '%0', windowName: 'Claude Code', paneCommand: 'claude', panePid: 100 }],
    );

    const shell = makeMockShell({ 100: 'claude --resume oldid --dangerously-skip-permissions' });

    const result = await snapshotSessionWindows(tmux, 'Dev/_ws', [], shell);

    expect(result).toEqual([
      {
        name: 'Claude Code',
        kind: 'claude',
        args: '--dangerously-skip-permissions',
        directory: '/home/user',
      },
    ]);
  });

  it('infers kind:claude without args when claude runs bare', async () => {
    const tmux = makeMockTmux(
      [{ index: 0, name: 'Claude Code', active: true }],
      [{ paneId: '%0', windowName: 'Claude Code', paneCommand: 'claude', panePid: 100 }],
    );

    const shell = makeMockShell({ 100: 'claude' });

    const result = await snapshotSessionWindows(tmux, 'Dev/_ws', [], shell);

    expect(result).toEqual([
      { name: 'Claude Code', kind: 'claude', directory: '/home/user' },
    ]);
  });

  // ── Persisted-order preservation ──

  it('returns windows in the persisted order, not tmux index order', async () => {
    const tmux = makeMockTmux(
      [
        { index: 0, name: 'A', active: false },
        { index: 1, name: 'B', active: true },
        { index: 2, name: 'C', active: false },
      ],
      [
        { paneId: '%0', windowName: 'A', paneCommand: 'zsh', panePid: 100 },
        { paneId: '%1', windowName: 'B', paneCommand: 'zsh', panePid: 101 },
        { paneId: '%2', windowName: 'C', paneCommand: 'zsh', panePid: 102 },
      ],
    );

    const existing = [
      { name: 'C', kind: 'command' as const },
      { name: 'A', kind: 'command' as const },
      { name: 'B', kind: 'command' as const },
    ];

    const result = await snapshotSessionWindows(tmux, 'Dev/_ws', existing);

    expect(result.map((w) => w.name)).toEqual(['C', 'A', 'B']);
  });

  it('appends live windows that are not in the persisted order at the end', async () => {
    const tmux = makeMockTmux(
      [
        { index: 0, name: 'A', active: false },
        { index: 1, name: 'B', active: true },
        { index: 2, name: 'C', active: false },
      ],
      [
        { paneId: '%0', windowName: 'A', paneCommand: 'zsh', panePid: 100 },
        { paneId: '%1', windowName: 'B', paneCommand: 'zsh', panePid: 101 },
        { paneId: '%2', windowName: 'C', paneCommand: 'zsh', panePid: 102 },
      ],
    );

    const existing = [
      { name: 'B', kind: 'command' as const },
      { name: 'A', kind: 'command' as const },
    ];

    const result = await snapshotSessionWindows(tmux, 'Dev/_ws', existing);

    expect(result.map((w) => w.name)).toEqual(['B', 'A', 'C']);
  });

  it('falls back to live order when no persisted order is given', async () => {
    const tmux = makeMockTmux(
      [
        { index: 0, name: 'A', active: false },
        { index: 1, name: 'B', active: true },
      ],
      [
        { paneId: '%0', windowName: 'A', paneCommand: 'zsh', panePid: 100 },
        { paneId: '%1', windowName: 'B', paneCommand: 'zsh', panePid: 101 },
      ],
    );

    const result = await snapshotSessionWindows(tmux, 'Dev/_ws', []);

    expect(result.map((w) => w.name)).toEqual(['A', 'B']);
  });

  it('preserves args and claudeSessionId from existing claude spec', async () => {
    const tmux = makeMockTmux(
      [{ index: 0, name: 'Claude Code', active: true }],
      [{ paneId: '%0', windowName: 'Claude Code', paneCommand: 'claude', panePid: 100 }],
    );

    const shell = makeMockShell({ 100: 'claude --resume current-id' });

    const existing = [
      {
        name: 'Claude Code',
        kind: 'claude' as const,
        args: '--dangerously-skip-permissions',
        claudeSessionId: 'sticky-id',
      },
    ];

    const result = await snapshotSessionWindows(tmux, 'Dev/_ws', existing, shell);

    expect(result).toEqual([
      {
        name: 'Claude Code',
        kind: 'claude',
        args: '--dangerously-skip-permissions',
        claudeSessionId: 'sticky-id',
        directory: '/home/user',
      },
    ]);
  });
});
