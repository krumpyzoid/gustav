// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LocalTransport } from '../local-transport';
import type { WindowInfo, WorkspaceAppState } from '../../../../main/domain/types';

const supervisorApi = {
  sendInput: vi.fn(),
  resizeClient: vi.fn(),
  onData: vi.fn(),
};

const api = {
  sendPtyInput: vi.fn(),
  sendPtyResize: vi.fn(),
  onPtyData: vi.fn(),
  getState: vi.fn(),
  onStateUpdate: vi.fn(),
  switchSession: vi.fn(),
  sleepSession: vi.fn(),
  wakeSession: vi.fn(),
  destroySession: vi.fn(),
  selectWindow: vi.fn(),
  newWindow: vi.fn(),
  killWindow: vi.fn(),
  setWindowOrder: vi.fn(),
  supervisor: supervisorApi,
};

beforeEach(() => {
  for (const fn of Object.values(api)) {
    if (typeof (fn as { mockReset?: () => void }).mockReset === 'function') {
      (fn as { mockReset: () => void }).mockReset();
    }
  }
  for (const fn of Object.values(supervisorApi)) fn.mockReset();
  // @ts-expect-error — partial window.api for tests
  globalThis.window.api = api;
});

describe('LocalTransport', () => {
  it('reports kind=local', () => {
    expect(new LocalTransport().kind).toBe('local');
  });

  it('sendPtyInput and sendPtyResize delegate to the local IPC', () => {
    const t = new LocalTransport();
    t.sendPtyInput('hello');
    t.sendPtyResize(120, 40);
    expect(api.sendPtyInput).toHaveBeenCalledWith('hello');
    expect(api.sendPtyResize).toHaveBeenCalledWith(120, 40);
  });

  it('onPtyData wires the listener through window.api.onPtyData and returns its cleanup', () => {
    const cleanup = vi.fn();
    api.onPtyData.mockReturnValue(cleanup);
    const listener = vi.fn();
    const t = new LocalTransport();

    const unsubscribe = t.onPtyData(listener);
    expect(api.onPtyData).toHaveBeenCalledWith(listener);

    unsubscribe();
    expect(cleanup).toHaveBeenCalled();
  });

  it('getState delegates to window.api.getState', async () => {
    const state = { defaultWorkspace: {}, workspaces: [], windows: [] } as unknown as WorkspaceAppState;
    api.getState.mockResolvedValue(state);
    const t = new LocalTransport();
    await expect(t.getState()).resolves.toBe(state);
  });

  it('onStateUpdate wires the listener and detach() clears the cleanup', () => {
    const cleanup = vi.fn();
    api.onStateUpdate.mockReturnValue(cleanup);
    const t = new LocalTransport();

    const unsub = t.onStateUpdate(vi.fn());
    expect(api.onStateUpdate).toHaveBeenCalled();

    unsub();
    expect(cleanup).toHaveBeenCalledTimes(1);

    // detach() does not double-invoke an already-released cleanup.
    t.detach();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('detach() releases active subscriptions registered via the transport', () => {
    const ptyCleanup = vi.fn();
    const stateCleanup = vi.fn();
    api.onPtyData.mockReturnValue(ptyCleanup);
    api.onStateUpdate.mockReturnValue(stateCleanup);

    const t = new LocalTransport();
    t.onPtyData(vi.fn());
    t.onStateUpdate(vi.fn());

    t.detach();
    expect(ptyCleanup).toHaveBeenCalled();
    expect(stateCleanup).toHaveBeenCalled();
  });

  it('session lifecycle methods delegate to window.api', async () => {
    const windows: WindowInfo[] = [{ index: 0, name: 'main', active: true }];
    api.switchSession.mockResolvedValue({ success: true, data: windows });
    api.sleepSession.mockResolvedValue({ success: true, data: undefined });
    api.wakeSession.mockResolvedValue({ success: true, data: windows });
    api.destroySession.mockResolvedValue({ success: true, data: undefined });

    const t = new LocalTransport();
    expect(await t.switchSession('s1')).toEqual({ success: true, data: windows });
    expect(await t.sleepSession('s1')).toEqual({ success: true, data: undefined });
    expect(await t.wakeSession('s1')).toEqual({ success: true, data: windows });
    expect(await t.destroySession('s1')).toEqual({ success: true, data: undefined });

    expect(api.switchSession).toHaveBeenCalledWith('s1');
    expect(api.sleepSession).toHaveBeenCalledWith('s1');
    expect(api.wakeSession).toHaveBeenCalledWith('s1');
    expect(api.destroySession).toHaveBeenCalledWith('s1');
  });

  describe('Phase 3 supervisor multiplexing', () => {
    it('forwards supervisor data for the active session into the same listener', () => {
      let supervisorListener: ((p: { sessionId: string; windowId: string; data: string }) => void) | null = null;
      api.onPtyData.mockReturnValue(() => {});
      supervisorApi.onData.mockImplementation((cb) => {
        supervisorListener = cb;
        return () => {};
      });

      const listener = vi.fn();
      const t = new LocalTransport(() => 'native-session-id');
      t.onPtyData(listener);

      expect(supervisorListener).not.toBeNull();
      // Active session: data flows through.
      supervisorListener!({ sessionId: 'native-session-id', windowId: 'w1', data: 'hello' });
      expect(listener).toHaveBeenCalledWith('hello');
    });

    it('drops supervisor data from non-active sessions (cross-session bleed prevention)', () => {
      let supervisorListener: ((p: { sessionId: string; windowId: string; data: string }) => void) | null = null;
      api.onPtyData.mockReturnValue(() => {});
      supervisorApi.onData.mockImplementation((cb) => {
        supervisorListener = cb;
        return () => {};
      });

      const listener = vi.fn();
      const t = new LocalTransport(() => 'session-a');
      t.onPtyData(listener);

      supervisorListener!({ sessionId: 'session-b', windowId: 'w1', data: 'leak' });
      expect(listener).not.toHaveBeenCalled();
    });

    it('detach() also tears down the supervisor subscription', () => {
      const tmuxCleanup = vi.fn();
      const superCleanup = vi.fn();
      api.onPtyData.mockReturnValue(tmuxCleanup);
      supervisorApi.onData.mockReturnValue(superCleanup);

      const t = new LocalTransport(() => null);
      t.onPtyData(vi.fn());
      t.detach();

      expect(tmuxCleanup).toHaveBeenCalled();
      expect(superCleanup).toHaveBeenCalled();
    });

    it('sendPtyInput forwards to the supervisor for the active session as well as legacy PTY', () => {
      const t = new LocalTransport(() => 'session-x');
      t.sendPtyInput('abc');
      expect(api.sendPtyInput).toHaveBeenCalledWith('abc');
      expect(supervisorApi.sendInput).toHaveBeenCalledWith('session-x', 'abc');
    });

    it('sendPtyResize mirrors to supervisor.resizeClient for the active session', () => {
      const t = new LocalTransport(() => 'session-x');
      t.sendPtyResize(140, 50);
      expect(api.sendPtyResize).toHaveBeenCalledWith(140, 50);
      expect(supervisorApi.resizeClient).toHaveBeenCalledWith({
        sessionId: 'session-x',
        clientId: 'local-renderer',
        cols: 140,
        rows: 50,
      });
    });
  });

  it('window commands delegate to window.api', async () => {
    api.selectWindow.mockResolvedValue({ success: true });
    api.newWindow.mockResolvedValue({ success: true });
    api.killWindow.mockResolvedValue({ success: true });
    api.setWindowOrder.mockResolvedValue({ success: true });

    const t = new LocalTransport();
    await t.selectWindow('s1', 'main');
    await t.newWindow('s1', 'logs');
    await t.killWindow('s1', 2);
    await t.setWindowOrder('s1', ['main', 'logs']);

    expect(api.selectWindow).toHaveBeenCalledWith('s1', 'main');
    expect(api.newWindow).toHaveBeenCalledWith('s1', 'logs');
    expect(api.killWindow).toHaveBeenCalledWith('s1', 2);
    expect(api.setWindowOrder).toHaveBeenCalledWith('s1', ['main', 'logs']);
  });
});
