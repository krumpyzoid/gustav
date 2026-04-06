import { describe, it, expect, vi } from 'vitest';
import { TmuxAdapter } from '../tmux.adapter';
import type { ShellPort } from '../../ports/shell.port';

function makeMockShell(): ShellPort {
  return {
    exec: vi.fn(),
  };
}

describe('TmuxAdapter.listWindows', () => {
  it('parses tmux list-windows output into WindowInfo[]', async () => {
    const shell = makeMockShell();
    vi.mocked(shell.exec).mockResolvedValue(
      '0\tClaude Code\t1\n1\tGit\t0\n2\tShell\t0\n'
    );

    const adapter = new TmuxAdapter(shell);
    const windows = await adapter.listWindows('myapp/feat');

    expect(windows).toEqual([
      { index: 0, name: 'Claude Code', active: true },
      { index: 1, name: 'Git', active: false },
      { index: 2, name: 'Shell', active: false },
    ]);
    expect(shell.exec).toHaveBeenCalledWith(
      "tmux list-windows -t 'myapp/feat' -F '#{window_index}\t#{window_name}\t#{window_active}'"
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
