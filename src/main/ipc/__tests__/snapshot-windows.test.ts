import { describe, it, expect, vi } from 'vitest';
import { snapshotSessionWindows } from '../snapshot-windows';
import type { TmuxPort } from '../../ports/tmux.port';

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

  it('captures user-created windows with their running command', async () => {
    const tmux = makeMockTmux(
      [
        { index: 0, name: 'Claude Code', active: false },
        { index: 1, name: 'Shell', active: false },
        { index: 2, name: 'Dev Server', active: true },
        { index: 3, name: 'Logs', active: false },
      ],
      [
        { paneId: '%0', windowName: 'Claude Code', paneCommand: 'claude', panePid: 100 },
        { paneId: '%1', windowName: 'Shell', paneCommand: 'fish', panePid: 101 },
        { paneId: '%2', windowName: 'Dev Server', paneCommand: 'node', panePid: 102 },
        { paneId: '%3', windowName: 'Logs', paneCommand: 'tail', panePid: 103 },
      ],
    );

    // Existing specs only have the template windows, plus user-created bare names
    const existing = [
      { name: 'Claude Code', command: 'claude' },
      { name: 'Shell' },
      { name: 'Dev Server' },  // bare name from NEW_WINDOW handler
    ];

    const result = await snapshotSessionWindows(tmux, 'Dev/_ws', existing);

    // Dev Server should get 'node' captured, Logs is new and gets 'tail'
    expect(result).toEqual([
      { name: 'Claude Code', command: 'claude' },
      { name: 'Shell' },
      { name: 'Dev Server', command: 'node' },
      { name: 'Logs', command: 'tail' },
    ]);
  });

  it('does not capture shell processes as commands', async () => {
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

    const existing = [{ name: 'Claude Code', command: 'claude' }];

    const result = await snapshotSessionWindows(tmux, 'Dev/_ws', existing);

    expect(result).toEqual([
      { name: 'Claude Code', command: 'claude' },
      { name: 'Scratch' },  // no command — just a shell
    ]);
  });

  it('includes windows not in existing specs (user created after last persistence)', async () => {
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

    // No existing specs at all (e.g. session was never persisted)
    const existing: string[] = [];

    const result = await snapshotSessionWindows(tmux, 'Dev/_ws', existing);

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

    // Legacy format: just string names
    const existing = ['Claude Code', 'Git', 'Shell'];

    const result = await snapshotSessionWindows(tmux, 'Dev/_ws', existing);

    expect(result).toEqual([
      { name: 'Claude Code', command: 'claude' },
      { name: 'Shell' },
    ]);
  });
});
