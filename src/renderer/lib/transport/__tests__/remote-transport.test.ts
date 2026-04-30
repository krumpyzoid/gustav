// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RemoteGustavTransport } from '../remote-transport';
import type { WindowInfo } from '../../../../main/domain/types';

const api = {
  // PTY
  sendRemotePtyInput: vi.fn(),
  sendRemotePtyResize: vi.fn(),
  onRemotePtyData: vi.fn(),
  // State
  onRemoteStateUpdate: vi.fn(),
  // Commands
  remoteSessionCommand: vi.fn(),
};

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  // @ts-expect-error — partial window.api for tests
  globalThis.window.api = api;
  api.onRemotePtyData.mockReturnValue(() => {});
  api.onRemoteStateUpdate.mockReturnValue(() => {});
  api.remoteSessionCommand.mockResolvedValue({ success: true });
});

describe('RemoteGustavTransport', () => {
  it('reports kind=remote', () => {
    expect(new RemoteGustavTransport().kind).toBe('remote');
  });

  // ── PTY data plane: pre-attach behaviour ─────────────────────────

  it('sendPtyInput is a no-op (with console.warn) when not yet attached', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const t = new RemoteGustavTransport();

    t.sendPtyInput('x');

    expect(api.sendRemotePtyInput).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('sendPtyResize is a no-op (with console.warn) when not yet attached', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const t = new RemoteGustavTransport();

    t.sendPtyResize(80, 24);

    expect(api.sendRemotePtyResize).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  // ── switchSession attaches a remote PTY ─────────────────────────

  it('onPtyData filters frames by channelId — only frames matching the attached channel reach the listener', async () => {
    let dispatchFrame!: (frame: { channelId: number; data: string }) => void;
    api.onRemotePtyData.mockImplementation((cb) => {
      dispatchFrame = cb;
      return () => {};
    });
    api.remoteSessionCommand.mockImplementation((action: string) => {
      if (action === 'attach-pty') return Promise.resolve({ success: true, data: { channelId: 7 } });
      return Promise.resolve({ success: true, data: [] });
    });

    const t = new RemoteGustavTransport();
    const listener = vi.fn();
    t.onPtyData(listener);

    // Before attach: ptyChannelId is null, frames are dropped regardless.
    dispatchFrame({ channelId: 7, data: 'pre-attach' });
    expect(listener).not.toHaveBeenCalled();

    // Attach to channel 7.
    await t.switchSession('Dev/_ws');

    // Stale frame from a different channel must not reach the listener.
    dispatchFrame({ channelId: 99, data: 'stale-other-channel' });
    expect(listener).not.toHaveBeenCalled();

    // Matching channel reaches the listener with just the data.
    dispatchFrame({ channelId: 7, data: 'live-data' });
    expect(listener).toHaveBeenCalledWith('live-data');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('switchSession tickles the new PTY with a resize so tmux redraws on attach', async () => {
    api.remoteSessionCommand.mockImplementation((action: string) => {
      if (action === 'attach-pty') return Promise.resolve({ success: true, data: { channelId: 5 } });
      return Promise.resolve({ success: true, data: [] });
    });

    const t = new RemoteGustavTransport();
    await t.switchSession('Dev/_ws', { cols: 132, rows: 50 });

    // Without this resize, tmux on the remote sits on its previous redraw
    // until the user manually resizes the OS window.
    expect(api.sendRemotePtyResize).toHaveBeenCalledWith(5, 132, 50);
  });

  it('switchSession sends attach-pty and stores the returned channel id', async () => {
    const remoteWindows: WindowInfo[] = [
      { index: 0, name: 'Editor', active: true },
    ];
    api.remoteSessionCommand.mockImplementation((action: string) => {
      if (action === 'attach-pty') return Promise.resolve({ success: true, data: { channelId: 42 } });
      if (action === 'list-windows') return Promise.resolve({ success: true, data: remoteWindows });
      return Promise.resolve({ success: true });
    });

    const t = new RemoteGustavTransport();
    const result = await t.switchSession('Dev/_ws');

    expect(api.remoteSessionCommand).toHaveBeenCalledWith(
      'attach-pty',
      { tmuxSession: 'Dev/_ws', cols: 80, rows: 24 },
    );
    expect(api.remoteSessionCommand).toHaveBeenCalledWith(
      'list-windows',
      { session: 'Dev/_ws' },
    );
    expect(result).toEqual({ success: true, data: remoteWindows });

    // Now PTY methods should route through with the stored channel id.
    t.sendPtyInput('hi');
    expect(api.sendRemotePtyInput).toHaveBeenCalledWith(42, 'hi');
    t.sendPtyResize(120, 30);
    expect(api.sendRemotePtyResize).toHaveBeenCalledWith(42, 120, 30);
  });

  it('switchSession forwards caller-provided cols/rows to attach-pty', async () => {
    const remoteWindows: WindowInfo[] = [{ index: 0, name: 'Editor', active: true }];
    api.remoteSessionCommand.mockImplementation((action: string) => {
      if (action === 'attach-pty') return Promise.resolve({ success: true, data: { channelId: 7 } });
      if (action === 'list-windows') return Promise.resolve({ success: true, data: remoteWindows });
      return Promise.resolve({ success: true });
    });

    const t = new RemoteGustavTransport();
    await t.switchSession('Dev/_ws', { cols: 173, rows: 47 });

    expect(api.remoteSessionCommand).toHaveBeenCalledWith(
      'attach-pty',
      { tmuxSession: 'Dev/_ws', cols: 173, rows: 47 },
    );
  });

  it('switchSession to a new session detaches the previous PTY first', async () => {
    api.remoteSessionCommand.mockImplementation((action: string) => {
      if (action === 'attach-pty') return Promise.resolve({ success: true, data: { channelId: 1 } });
      return Promise.resolve({ success: true, data: [] });
    });

    const t = new RemoteGustavTransport();
    await t.switchSession('S1');

    api.remoteSessionCommand.mockImplementation((action: string) => {
      if (action === 'attach-pty') return Promise.resolve({ success: true, data: { channelId: 2 } });
      return Promise.resolve({ success: true, data: [] });
    });
    await t.switchSession('S2');

    expect(api.remoteSessionCommand).toHaveBeenCalledWith(
      'detach-pty',
      { channelId: 1 },
    );

    t.sendPtyInput('x');
    expect(api.sendRemotePtyInput).toHaveBeenLastCalledWith(2, 'x');
  });

  it('switchSession returns an error when attach-pty data has no channelId field', async () => {
    api.remoteSessionCommand.mockImplementation((action: string) => {
      if (action === 'attach-pty') return Promise.resolve({ success: true, data: { channelId: 'not-a-number' } });
      return Promise.resolve({ success: true, data: [] });
    });

    const t = new RemoteGustavTransport();
    const result = await t.switchSession('Dev/_ws');

    expect(result).toEqual({ success: false, error: 'attach-pty did not return a channelId' });
    // No follow-up list-windows when the channelId guard fires.
    expect(api.remoteSessionCommand).not.toHaveBeenCalledWith('list-windows', expect.anything());
  });

  it('switchSession returns the attach failure as a Result error when attach-pty fails', async () => {
    api.remoteSessionCommand.mockImplementation((action: string) => {
      if (action === 'attach-pty') return Promise.resolve({ success: false, error: 'not connected' });
      return Promise.resolve({ success: true, data: [] });
    });

    const t = new RemoteGustavTransport();
    const result = await t.switchSession('Dev/_ws');

    expect(result).toEqual({ success: false, error: 'not connected' });
    // No follow-up list-windows when attach failed.
    expect(api.remoteSessionCommand).not.toHaveBeenCalledWith('list-windows', expect.anything());
  });

  // ── Other lifecycle commands route via remoteSessionCommand ─────

  it('sleepSession dispatches sleep-session', async () => {
    const t = new RemoteGustavTransport();
    await t.sleepSession('Dev/_ws');
    expect(api.remoteSessionCommand).toHaveBeenCalledWith(
      'sleep-session',
      { session: 'Dev/_ws' },
    );
  });

  it('wakeSession dispatches wake-session', async () => {
    const t = new RemoteGustavTransport();
    await t.wakeSession('Dev/_ws');
    expect(api.remoteSessionCommand).toHaveBeenCalledWith(
      'wake-session',
      { session: 'Dev/_ws' },
    );
  });

  it('destroySession dispatches destroy-session', async () => {
    const t = new RemoteGustavTransport();
    await t.destroySession('Dev/_ws');
    expect(api.remoteSessionCommand).toHaveBeenCalledWith(
      'destroy-session',
      { session: 'Dev/_ws' },
    );
  });

  it('selectWindow dispatches select-window with the right shape', async () => {
    const t = new RemoteGustavTransport();
    await t.selectWindow('Dev/_ws', 'Editor');
    expect(api.remoteSessionCommand).toHaveBeenCalledWith(
      'select-window',
      { session: 'Dev/_ws', window: 'Editor' },
    );
  });

  it('newWindow dispatches new-window with the right shape', async () => {
    const t = new RemoteGustavTransport();
    await t.newWindow('Dev/_ws', 'Notes');
    expect(api.remoteSessionCommand).toHaveBeenCalledWith(
      'new-window',
      { session: 'Dev/_ws', name: 'Notes' },
    );
  });

  it('killWindow dispatches kill-window with the windowIndex param', async () => {
    const t = new RemoteGustavTransport();
    await t.killWindow('Dev/_ws', 3);
    expect(api.remoteSessionCommand).toHaveBeenCalledWith(
      'kill-window',
      { session: 'Dev/_ws', windowIndex: 3 },
    );
  });

  it('setWindowOrder dispatches set-window-order with names array', async () => {
    const t = new RemoteGustavTransport();
    await t.setWindowOrder('Dev/_ws', ['Editor', 'Logs']);
    expect(api.remoteSessionCommand).toHaveBeenCalledWith(
      'set-window-order',
      { session: 'Dev/_ws', names: ['Editor', 'Logs'] },
    );
  });

  // ── State subscription ─────────────────────────────────────────

  it('getState round-trips through remoteSessionCommand("get-state")', async () => {
    const fakeState = { defaultWorkspace: { workspace: null, sessions: [], repoGroups: [], status: 'none' }, workspaces: [], windows: [] };
    api.remoteSessionCommand.mockResolvedValue({ success: true, data: fakeState });

    const t = new RemoteGustavTransport();
    const out = await t.getState();

    expect(api.remoteSessionCommand).toHaveBeenCalledWith('get-state', {});
    expect(out).toEqual(fakeState);
  });

  it('getState rejects when the remote command fails', async () => {
    api.remoteSessionCommand.mockResolvedValue({ success: false, error: 'not connected' });
    const t = new RemoteGustavTransport();
    await expect(t.getState()).rejects.toThrow(/not connected/);
  });

  it('onStateUpdate wraps window.api.onRemoteStateUpdate', () => {
    const cleanup = vi.fn();
    api.onRemoteStateUpdate.mockReturnValue(cleanup);
    const t = new RemoteGustavTransport();

    const listener = vi.fn();
    const unsub = t.onStateUpdate(listener);
    expect(api.onRemoteStateUpdate).toHaveBeenCalledWith(listener);

    unsub();
    expect(cleanup).toHaveBeenCalled();
  });

  // ── detach() ──────────────────────────────────────────────────

  it('detach() sends detach-pty for the active channel and clears it', async () => {
    api.remoteSessionCommand.mockImplementation((action: string) => {
      if (action === 'attach-pty') return Promise.resolve({ success: true, data: { channelId: 9 } });
      return Promise.resolve({ success: true, data: [] });
    });

    const t = new RemoteGustavTransport();
    await t.switchSession('Dev/_ws');

    t.detach();
    expect(api.remoteSessionCommand).toHaveBeenCalledWith(
      'detach-pty',
      { channelId: 9 },
    );

    // After detach, PTY methods become no-ops again.
    api.sendRemotePtyInput.mockClear();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    t.sendPtyInput('x');
    expect(api.sendRemotePtyInput).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  describe('session creation methods', () => {
    it('createWorkspaceSession dispatches create-workspace-session', async () => {
      api.remoteSessionCommand.mockResolvedValue({ success: true, data: 'Dev/_ws' });
      const t = new RemoteGustavTransport();

      const r = await t.createWorkspaceSession('Dev', '/srv/dev', 'scratch');

      expect(api.remoteSessionCommand).toHaveBeenCalledWith(
        'create-workspace-session',
        { workspaceName: 'Dev', workspaceDir: '/srv/dev', label: 'scratch' },
      );
      expect(r).toEqual({ success: true, data: 'Dev/_ws' });
    });

    it('createRepoSession dispatches create-repo-session with all params', async () => {
      api.remoteSessionCommand.mockResolvedValue({ success: true, data: 'Dev/repo/main' });
      const t = new RemoteGustavTransport();

      const r = await t.createRepoSession('Dev', '/srv/repo', 'worktree', 'feat/x', 'origin/main');

      expect(api.remoteSessionCommand).toHaveBeenCalledWith(
        'create-repo-session',
        { workspaceName: 'Dev', repoRoot: '/srv/repo', mode: 'worktree', branch: 'feat/x', base: 'origin/main' },
      );
      expect(r).toEqual({ success: true, data: 'Dev/repo/main' });
    });

    it('createStandaloneSession dispatches create-standalone-session', async () => {
      api.remoteSessionCommand.mockResolvedValue({ success: true, data: '_standalone/scratch' });
      const t = new RemoteGustavTransport();

      const r = await t.createStandaloneSession('scratch', '/tmp/s');

      expect(api.remoteSessionCommand).toHaveBeenCalledWith(
        'create-standalone-session',
        { label: 'scratch', dir: '/tmp/s' },
      );
      expect(r).toEqual({ success: true, data: '_standalone/scratch' });
    });

    it('getBranches dispatches get-branches and unwraps the Result envelope', async () => {
      api.remoteSessionCommand.mockResolvedValue({ success: true, data: [{ name: 'main', isRemote: false }] });
      const t = new RemoteGustavTransport();

      const r = await t.getBranches('/srv/repo');

      expect(api.remoteSessionCommand).toHaveBeenCalledWith(
        'get-branches',
        { repoRoot: '/srv/repo' },
      );
      expect(r).toEqual([{ name: 'main', isRemote: false }]);
    });

    it('getBranches returns [] when the remote command fails', async () => {
      api.remoteSessionCommand.mockResolvedValue({ success: false, error: 'not connected' });
      const t = new RemoteGustavTransport();

      const r = await t.getBranches('/srv/repo');

      expect(r).toEqual([]);
    });
  });

  it('detach() releases all subscriptions registered through the transport', () => {
    const ptyCleanup = vi.fn();
    const stateCleanup = vi.fn();
    api.onRemotePtyData.mockReturnValue(ptyCleanup);
    api.onRemoteStateUpdate.mockReturnValue(stateCleanup);

    const t = new RemoteGustavTransport();
    t.onPtyData(vi.fn());
    t.onStateUpdate(vi.fn());

    t.detach();
    expect(ptyCleanup).toHaveBeenCalled();
    expect(stateCleanup).toHaveBeenCalled();
  });
});
