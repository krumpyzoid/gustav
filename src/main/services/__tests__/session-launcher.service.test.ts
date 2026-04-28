import { describe, it, expect, vi } from 'vitest';
import { SessionLauncherService } from '../session-launcher.service';
import type { SessionService } from '../session.service';
import type { PreferenceService } from '../preference.service';
import type { SessionSupervisorPort } from '../../supervisor/supervisor.port';
import type { Preferences, WindowSpec } from '../../domain/types';

function makeMockSessionService(): SessionService {
  return {
    launchSession: vi.fn().mockImplementation(async (id: string) => id),
  } as unknown as SessionService;
}

function makeMockSupervisor(): SessionSupervisorPort {
  return {
    createSession: vi.fn().mockResolvedValue(undefined),
    killSession: vi.fn().mockResolvedValue(undefined),
    hasSession: vi.fn().mockReturnValue(false),
    listSessions: vi.fn().mockReturnValue([]),
    addWindow: vi.fn().mockResolvedValue('w1'),
    killWindow: vi.fn().mockResolvedValue(undefined),
    selectWindow: vi.fn().mockResolvedValue(undefined),
    listWindows: vi.fn().mockReturnValue([]),
    sleepSession: vi.fn().mockResolvedValue(undefined),
    wakeSession: vi.fn().mockResolvedValue(undefined),
    attachClient: vi.fn(),
    detachClient: vi.fn(),
    resizeClient: vi.fn(),
    sendInput: vi.fn(),
    onWindowData: vi.fn().mockReturnValue(() => {}),
    onSessionStateChange: vi.fn().mockReturnValue(() => {}),
    getReplay: vi.fn().mockReturnValue(''),
    close: vi.fn(),
  } as unknown as SessionSupervisorPort;
}

function makeMockPrefs(prefs: Preferences): PreferenceService {
  return {
    load: vi.fn().mockReturnValue(prefs),
  } as unknown as PreferenceService;
}

const SAMPLE_WINDOWS: WindowSpec[] = [
  { name: 'Claude Code', kind: 'claude' },
  { name: 'Shell', kind: 'command' },
];

describe('SessionLauncherService.launch', () => {
  it('routes to tmux when sessionSupervisor is unset (default)', async () => {
    const sessionService = makeMockSessionService();
    const supervisor = makeMockSupervisor();
    const prefs = makeMockPrefs({});

    const launcher = new SessionLauncherService(sessionService, supervisor, prefs);
    const result = await launcher.launch('Dev/api/_dir', '/tmp/api', SAMPLE_WINDOWS);

    expect(result).toEqual({ sessionId: 'Dev/api/_dir', backend: 'tmux' });
    expect(sessionService.launchSession).toHaveBeenCalledWith('Dev/api/_dir', '/tmp/api', SAMPLE_WINDOWS);
    expect(supervisor.createSession).not.toHaveBeenCalled();
  });

  it('routes to tmux when sessionSupervisor is explicitly tmux', async () => {
    const sessionService = makeMockSessionService();
    const supervisor = makeMockSupervisor();
    const prefs = makeMockPrefs({ sessionSupervisor: 'tmux' });

    const launcher = new SessionLauncherService(sessionService, supervisor, prefs);
    const result = await launcher.launch('Dev/api/_dir', '/tmp/api', SAMPLE_WINDOWS);

    expect(result.backend).toBe('tmux');
    expect(sessionService.launchSession).toHaveBeenCalledOnce();
    expect(supervisor.createSession).not.toHaveBeenCalled();
  });

  it('routes to the supervisor when sessionSupervisor is native', async () => {
    const sessionService = makeMockSessionService();
    const supervisor = makeMockSupervisor();
    const prefs = makeMockPrefs({ sessionSupervisor: 'native' });

    const launcher = new SessionLauncherService(sessionService, supervisor, prefs);
    const result = await launcher.launch('Dev/api/_dir', '/tmp/api', SAMPLE_WINDOWS);

    expect(result).toEqual({ sessionId: 'Dev/api/_dir', backend: 'native' });
    expect(supervisor.createSession).toHaveBeenCalledWith({
      sessionId: 'Dev/api/_dir',
      cwd: '/tmp/api',
      windows: SAMPLE_WINDOWS,
    });
    expect(sessionService.launchSession).not.toHaveBeenCalled();
  });

  it('returns the launcher result so callers can persist the right backend', async () => {
    const sessionService = makeMockSessionService();
    const supervisor = makeMockSupervisor();
    const nativePrefs = makeMockPrefs({ sessionSupervisor: 'native' });

    const launcher = new SessionLauncherService(sessionService, supervisor, nativePrefs);
    const r = await launcher.launch('s1', '/tmp', SAMPLE_WINDOWS);
    expect(r.backend).toBe('native');
    expect(r.sessionId).toBe('s1');
  });
});
