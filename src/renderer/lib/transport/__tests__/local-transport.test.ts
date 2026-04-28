// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LocalTransport } from '../local-transport';
import type { WindowInfo, WorkspaceAppState } from '../../../../main/domain/types';

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
};

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
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
