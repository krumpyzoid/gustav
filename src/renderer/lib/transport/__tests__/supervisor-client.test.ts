// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SupervisorClient } from '../supervisor-client';
import type { WindowSpec } from '../../../../main/domain/types';

const supervisorApi = {
  createSession: vi.fn(),
  killSession: vi.fn(),
  hasSession: vi.fn(),
  addWindow: vi.fn(),
  killWindow: vi.fn(),
  selectWindow: vi.fn(),
  listWindows: vi.fn(),
  sleepSession: vi.fn(),
  wakeSession: vi.fn(),
  attachClient: vi.fn(),
  detachClient: vi.fn(),
  resizeClient: vi.fn(),
  sendInput: vi.fn(),
  getReplay: vi.fn(),
  onData: vi.fn(),
  onStateChange: vi.fn(),
};

beforeEach(() => {
  for (const fn of Object.values(supervisorApi)) fn.mockReset();
  // @ts-expect-error — partial window.api for tests
  globalThis.window.api = { supervisor: supervisorApi };
});

describe('SupervisorClient', () => {
  it('createSession delegates with the same payload', async () => {
    supervisorApi.createSession.mockResolvedValue({ success: true, data: undefined });
    const c = new SupervisorClient();
    const spec: WindowSpec = { name: 'Claude', kind: 'claude' };
    await c.createSession({ sessionId: 's1', cwd: '/tmp', windows: [spec] });
    expect(supervisorApi.createSession).toHaveBeenCalledWith({
      sessionId: 's1',
      cwd: '/tmp',
      windows: [spec],
    });
  });

  it('window lifecycle methods delegate to window.api.supervisor', async () => {
    supervisorApi.addWindow.mockResolvedValue({ success: true, data: 'w42' });
    supervisorApi.killWindow.mockResolvedValue({ success: true, data: undefined });
    supervisorApi.selectWindow.mockResolvedValue({ success: true, data: undefined });
    supervisorApi.listWindows.mockResolvedValue({ success: true, data: [] });

    const c = new SupervisorClient();
    const spec: WindowSpec = { name: 'shell', kind: 'command', command: 'bash' };

    expect(await c.addWindow('s1', spec)).toEqual({ success: true, data: 'w42' });
    expect(await c.killWindow('s1', 'w1')).toEqual({ success: true, data: undefined });
    expect(await c.selectWindow('s1', 'w1')).toEqual({ success: true, data: undefined });
    expect(await c.listWindows('s1')).toEqual({ success: true, data: [] });

    expect(supervisorApi.addWindow).toHaveBeenCalledWith('s1', spec);
    expect(supervisorApi.killWindow).toHaveBeenCalledWith('s1', 'w1');
    expect(supervisorApi.selectWindow).toHaveBeenCalledWith('s1', 'w1');
    expect(supervisorApi.listWindows).toHaveBeenCalledWith('s1');
  });

  it('sleep/wake delegate', async () => {
    supervisorApi.sleepSession.mockResolvedValue({ success: true, data: undefined });
    supervisorApi.wakeSession.mockResolvedValue({ success: true, data: undefined });

    const c = new SupervisorClient();
    await c.sleepSession('s1');
    await c.wakeSession('s1');
    expect(supervisorApi.sleepSession).toHaveBeenCalledWith('s1');
    expect(supervisorApi.wakeSession).toHaveBeenCalledWith('s1');
  });

  it('client mgmt fire-and-forget delegates', () => {
    const c = new SupervisorClient();
    c.attachClient({ sessionId: 's1', clientId: 'cA', cols: 80, rows: 24 });
    c.detachClient('s1', 'cA');
    c.resizeClient({ sessionId: 's1', clientId: 'cA', cols: 100, rows: 30 });
    expect(supervisorApi.attachClient).toHaveBeenCalledWith({ sessionId: 's1', clientId: 'cA', cols: 80, rows: 24 });
    expect(supervisorApi.detachClient).toHaveBeenCalledWith('s1', 'cA');
    expect(supervisorApi.resizeClient).toHaveBeenCalledWith({ sessionId: 's1', clientId: 'cA', cols: 100, rows: 30 });
  });

  it('sendInput and getReplay delegate', async () => {
    supervisorApi.getReplay.mockResolvedValue({ success: true, data: 'buffered' });
    const c = new SupervisorClient();
    c.sendInput('s1', 'echo\n');
    expect(supervisorApi.sendInput).toHaveBeenCalledWith('s1', 'echo\n');
    expect(await c.getReplay('s1', 'w1')).toEqual({ success: true, data: 'buffered' });
    expect(supervisorApi.getReplay).toHaveBeenCalledWith('s1', 'w1');
  });

  it('onData and onStateChange wire listeners and detach() releases them', () => {
    const dataCleanup = vi.fn();
    const stateCleanup = vi.fn();
    supervisorApi.onData.mockReturnValue(dataCleanup);
    supervisorApi.onStateChange.mockReturnValue(stateCleanup);

    const c = new SupervisorClient();
    c.onData(vi.fn());
    c.onStateChange(vi.fn());
    expect(supervisorApi.onData).toHaveBeenCalled();
    expect(supervisorApi.onStateChange).toHaveBeenCalled();

    c.detach();
    expect(dataCleanup).toHaveBeenCalled();
    expect(stateCleanup).toHaveBeenCalled();
  });

  it('explicit unsubscribe is idempotent with detach()', () => {
    const dataCleanup = vi.fn();
    supervisorApi.onData.mockReturnValue(dataCleanup);

    const c = new SupervisorClient();
    const unsub = c.onData(vi.fn());
    unsub();
    expect(dataCleanup).toHaveBeenCalledTimes(1);
    c.detach();
    // Already-released cleanup should not be invoked twice.
    expect(dataCleanup).toHaveBeenCalledTimes(1);
  });
});
