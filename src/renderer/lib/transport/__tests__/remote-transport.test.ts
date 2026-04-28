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
