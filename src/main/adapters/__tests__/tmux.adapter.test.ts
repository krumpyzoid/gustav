import { describe, it, expect, vi } from 'vitest';
import { TmuxAdapter } from '../tmux.adapter';
import type { ShellPort } from '../../ports/shell.port';

function makeMockShell(): ShellPort {
  return {
    exec: vi.fn(),
    execSync: vi.fn().mockReturnValue(''),
  };
}

describe('TmuxAdapter.listWindows', () => {
  it('parses tmux list-windows output into WindowInfo[]', async () => {
    const shell = makeMockShell();
    vi.mocked(shell.exec).mockResolvedValue(
      '0|||Claude Code|||1\n1|||Git|||0\n2|||Shell|||0\n'
    );

    const adapter = new TmuxAdapter(shell);
    const windows = await adapter.listWindows('myapp/feat');

    expect(windows).toEqual([
      { index: 0, name: 'Claude Code', active: true },
      { index: 1, name: 'Git', active: false },
      { index: 2, name: 'Shell', active: false },
    ]);
    expect(shell.exec).toHaveBeenCalledWith(
      "tmux list-windows -t 'myapp/feat' -F '#{window_index}|||#{window_name}|||#{window_active}'"
    );
  });

  it('returns empty array when session has no windows', async () => {
    const shell = makeMockShell();
    vi.mocked(shell.exec).mockResolvedValue('');

    const adapter = new TmuxAdapter(shell);
    const windows = await adapter.listWindows('myapp/feat');

    expect(windows).toEqual([]);
  });

  it('returns empty array when tmux command fails', async () => {
    const shell = makeMockShell();
    vi.mocked(shell.exec).mockRejectedValue(new Error('no session'));

    const adapter = new TmuxAdapter(shell);
    const windows = await adapter.listWindows('myapp/feat');

    expect(windows).toEqual([]);
  });
});

describe('TmuxAdapter.killWindow', () => {
  it('executes tmux kill-window with session and window index', async () => {
    const shell = makeMockShell();
    vi.mocked(shell.exec).mockResolvedValue('');

    const adapter = new TmuxAdapter(shell);
    await adapter.killWindow('myapp/feat', 2);

    expect(shell.exec).toHaveBeenCalledWith(
      "tmux kill-window -t 'myapp/feat':2"
    );
  });
});

describe('TmuxAdapter.listClients', () => {
  it('parses list-clients output into tty/pid pairs', async () => {
    const shell = makeMockShell();
    vi.mocked(shell.exec).mockResolvedValue(
      '/dev/ttys001 12345\n/dev/ttys002 67890'
    );

    const adapter = new TmuxAdapter(shell);
    const clients = await adapter.listClients();

    expect(clients).toEqual([
      { tty: '/dev/ttys001', pid: 12345 },
      { tty: '/dev/ttys002', pid: 67890 },
    ]);
    expect(shell.exec).toHaveBeenCalledWith(
      "tmux list-clients -F '#{client_tty} #{client_pid}'"
    );
  });

  it('returns empty array when no clients connected', async () => {
    const shell = makeMockShell();
    vi.mocked(shell.exec).mockRejectedValue(new Error('no clients'));

    const adapter = new TmuxAdapter(shell);
    const clients = await adapter.listClients();

    expect(clients).toEqual([]);
  });
});

describe('TmuxAdapter.sendKeys', () => {
  it('quotes multi-word commands to preserve spaces', async () => {
    const shell = makeMockShell();
    vi.mocked(shell.exec).mockResolvedValue('');

    const adapter = new TmuxAdapter(shell);
    await adapter.sendKeys('myapp/feat:Frontend', 'pnpm run dev');

    expect(shell.exec).toHaveBeenCalledWith(
      "tmux send-keys -t 'myapp/feat:Frontend' 'pnpm run dev' Enter"
    );
  });
});

describe('TmuxAdapter.listPanesExtended', () => {
  it('parses panes with all fields', async () => {
    const shell = makeMockShell();
    vi.mocked(shell.exec).mockResolvedValue(
      '%0|||Claude Code|||claude|||12345|||/home/user/api\n%1|||Git|||lazygit|||12346|||/home/user/api\n%2|||Shell|||fish|||12347|||/home/user/api/src'
    );

    const adapter = new TmuxAdapter(shell);
    const panes = await adapter.listPanesExtended('myapp/feat');

    expect(panes).toEqual([
      { paneId: '%0', windowName: 'Claude Code', paneCommand: 'claude', panePid: 12345, paneCwd: '/home/user/api' },
      { paneId: '%1', windowName: 'Git', paneCommand: 'lazygit', panePid: 12346, paneCwd: '/home/user/api' },
      { paneId: '%2', windowName: 'Shell', paneCommand: 'fish', panePid: 12347, paneCwd: '/home/user/api/src' },
    ]);
    expect(shell.exec).toHaveBeenCalledWith(
      "tmux list-panes -t 'myapp/feat' -s -F '#{pane_id}|||#{window_name}|||#{pane_current_command}|||#{pane_pid}|||#{pane_current_path}'"
    );
  });

  it('returns empty array for empty output', async () => {
    const shell = makeMockShell();
    vi.mocked(shell.exec).mockResolvedValue('');

    const adapter = new TmuxAdapter(shell);
    const panes = await adapter.listPanesExtended('myapp/feat');

    expect(panes).toEqual([]);
  });

  it('skips blank lines', async () => {
    const shell = makeMockShell();
    vi.mocked(shell.exec).mockResolvedValue(
      '%0|||Claude Code|||claude|||12345|||/home/user\n\n%1|||Shell|||fish|||12346|||/home/user\n'
    );

    const adapter = new TmuxAdapter(shell);
    const panes = await adapter.listPanesExtended('myapp/feat');

    expect(panes).toHaveLength(2);
    expect(panes[0]).toEqual({ paneId: '%0', windowName: 'Claude Code', paneCommand: 'claude', panePid: 12345, paneCwd: '/home/user' });
    expect(panes[1]).toEqual({ paneId: '%1', windowName: 'Shell', paneCommand: 'fish', panePid: 12346, paneCwd: '/home/user' });
  });
});
