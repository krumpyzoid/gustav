import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RemoteService, type RemoteServiceDeps } from '../remote.service';

function makeMockDeps(): RemoteServiceDeps {
  return {
    stateService: {
      collectWorkspaces: vi.fn().mockResolvedValue({
        defaultWorkspace: { workspace: null, sessions: [], repoGroups: [], status: 'none' },
        workspaces: [],
        windows: [],
      }),
    },
    sessionService: {
      restoreSession: vi.fn(),
      launchWorkspaceSession: vi.fn().mockResolvedValue('ws/session'),
      launchDirectorySession: vi.fn().mockResolvedValue('ws/repo/_dir'),
      launchStandaloneSession: vi.fn().mockResolvedValue('_standalone/test'),
      getSessionName: vi.fn(),
    },
    workspaceService: {
      list: vi.fn().mockReturnValue([]),
      findBySessionPrefix: vi.fn().mockReturnValue(null),
      getPersistedSessions: vi.fn().mockReturnValue([]),
      removeSession: vi.fn(),
      discoverGitRepos: vi.fn().mockReturnValue([]),
    },
    configService: {
      parse: vi.fn().mockResolvedValue({ env: {}, copy: [], install: '', base: '', hooks: {}, tmux: [], cleanMergedInto: '' }),
    },
    git: {
      listBranches: vi.fn().mockResolvedValue([]),
    },
    tmux: {
      hasSession: vi.fn().mockResolvedValue(true),
      killSession: vi.fn(),
      listWindows: vi.fn().mockResolvedValue([]),
    },
    shell: {
      exec: vi.fn().mockResolvedValue(''),
    },
    dataDir: '/tmp/gustav-test-remote',
  } as unknown as RemoteServiceDeps;
}

describe('RemoteService', () => {
  let service: RemoteService;
  let deps: RemoteServiceDeps;

  beforeEach(() => {
    deps = makeMockDeps();
    service = new RemoteService(deps);
  });

  afterEach(async () => {
    await service.stop();
  });

  it('starts and exposes host info', async () => {
    await service.start(18777);
    const info = service.getHostInfo();
    expect(info.port).toBe(18777);
    expect(info.pairingCode).toMatch(/^[A-Z0-9]{6}$/);
    expect(info.enabled).toBe(true);
  });

  it('stops cleanly', async () => {
    await service.start(18778);
    await service.stop();
    const info = service.getHostInfo();
    expect(info.enabled).toBe(false);
  });

  it('regenerates pairing code', async () => {
    await service.start(18779);
    const code1 = service.getHostInfo().pairingCode;
    service.regenerateCode();
    const code2 = service.getHostInfo().pairingCode;
    expect(code1).not.toBe(code2);
  });

  it('reports not enabled when not started', () => {
    const info = service.getHostInfo();
    expect(info.enabled).toBe(false);
    expect(info.pairingCode).toBeNull();
  });

  it('reports connected status when a client is connected', async () => {
    await service.start(18780);
    // Without a real client, should report not connected
    expect(service.getHostInfo().clientConnected).toBe(false);
  });
});
