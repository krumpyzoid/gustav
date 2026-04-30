import { describe, it, expect, vi } from 'vitest';
import { CommandDispatcher } from '../command-dispatcher';
import type { StateService } from '../../services/state.service';
import type { SessionService } from '../../services/session.service';
import type { WorkspaceService } from '../../services/workspace.service';
import type { WorktreeService } from '../../services/worktree.service';
import type { GitPort } from '../../ports/git.port';
import type { TmuxPort } from '../../ports/tmux.port';

function makeMockDeps() {
  const stateService = {
    collectWorkspaces: vi.fn().mockResolvedValue({
      defaultWorkspace: { workspace: null, sessions: [], repoGroups: [], status: 'none' },
      workspaces: [],
      windows: [],
    }),
  } as unknown as StateService;

  const sessionService = {
    launchSession: vi.fn().mockResolvedValue('ws/session'),
    switchTo: vi.fn(),
    getSessionName: vi.fn().mockReturnValue('ws/session'),
    restoreSession: vi.fn(),
  } as unknown as SessionService;

  const workspaceService = {
    list: vi.fn().mockReturnValue([]),
    create: vi.fn().mockResolvedValue({ id: 'ws1', name: 'test', directory: '/tmp' }),
    findBySessionPrefix: vi.fn().mockReturnValue(null),
    findPersistedBackend: vi.fn().mockReturnValue(null),
    getPersistedSessions: vi.fn().mockReturnValue([]),
    persistSession: vi.fn(),
    removeSession: vi.fn(),
    discoverGitRepos: vi.fn().mockReturnValue([]),
    setSessionWindowOrder: vi.fn().mockResolvedValue(undefined),
  } as unknown as WorkspaceService;

  const tmux = {
    hasSession: vi.fn().mockResolvedValue(true),
    killSession: vi.fn(),
    listWindows: vi.fn().mockResolvedValue([]),
    selectWindow: vi.fn().mockResolvedValue(undefined),
    newWindow: vi.fn().mockResolvedValue(undefined),
    killWindow: vi.fn().mockResolvedValue(undefined),
    displayMessage: vi.fn().mockResolvedValue('/home/user'),
  } as unknown as TmuxPort;

  const repoConfigService = {
    get: vi.fn().mockReturnValue(null),
  } as unknown as import('../../services/repo-config.service').RepoConfigService;

  const preferenceService = {
    load: vi.fn().mockReturnValue({ defaultTabs: [] }),
  } as unknown as import('../../services/preference.service').PreferenceService;

  const git = {
    listBranches: vi.fn().mockResolvedValue([]),
    getWorktreeDir: vi.fn().mockReturnValue('/tmp/worktrees'),
  } as unknown as GitPort;

  const supervisor = {
    hasSession: vi.fn().mockReturnValue(false),
    listSessions: vi.fn().mockReturnValue([]),
    listWindows: vi.fn().mockReturnValue([]),
    createSession: vi.fn().mockResolvedValue(undefined),
    sleepSession: vi.fn().mockResolvedValue(undefined),
    wakeSession: vi.fn().mockResolvedValue(undefined),
    killSession: vi.fn().mockResolvedValue(undefined),
    addWindow: vi.fn().mockResolvedValue('w-id'),
    selectWindow: vi.fn().mockResolvedValue(undefined),
    killWindow: vi.fn().mockResolvedValue(undefined),
  } as unknown as import('../../supervisor/supervisor.port').SessionSupervisorPort;

  const sessionLauncher = {
    launch: vi.fn().mockResolvedValue({ sessionId: 'ws/session', backend: 'tmux' }),
  } as unknown as import('../../services/session-launcher.service').SessionLauncherService;

  const worktreeService = {
    create: vi.fn().mockResolvedValue(undefined),
  } as unknown as WorktreeService;

  // Default to permissive — individual tests opt into restrictive checks.
  const isAllowedDirectory = () => true;

  return { stateService, sessionService, workspaceService, tmux, repoConfigService, preferenceService, git, supervisor, sessionLauncher, worktreeService, isAllowedDirectory };
}

describe('CommandDispatcher', () => {
  it('dispatches get-state and returns workspace state', async () => {
    const deps = makeMockDeps();
    const dispatcher = new CommandDispatcher(deps);

    const result = await dispatcher.dispatch('get-state', {});
    expect(result.success).toBe(true);
    expect(deps.stateService.collectWorkspaces).toHaveBeenCalled();
  });

  it('dispatches sleep-session', async () => {
    const deps = makeMockDeps();
    deps.workspaceService.findBySessionPrefix = vi.fn().mockReturnValue({ id: 'ws1', name: 'ws' });
    const dispatcher = new CommandDispatcher(deps);

    const result = await dispatcher.dispatch('sleep-session', { session: 'ws/repo/_dir' });
    expect(result.success).toBe(true);
    expect(deps.tmux.killSession).toHaveBeenCalledWith('ws/repo/_dir');
  });

  it('dispatches wake-session', async () => {
    const deps = makeMockDeps();
    deps.workspaceService.findBySessionPrefix = vi.fn().mockReturnValue({ id: 'ws1', name: 'ws', sessions: [] });
    deps.workspaceService.getPersistedSessions = vi.fn().mockReturnValue([
      { tmuxSession: 'ws/repo/_dir', type: 'directory', directory: '/tmp', windows: [] },
    ]);
    const dispatcher = new CommandDispatcher(deps);

    const result = await dispatcher.dispatch('wake-session', { session: 'ws/repo/_dir' });
    expect(result.success).toBe(true);
    expect(deps.sessionService.restoreSession).toHaveBeenCalled();
  });

  it('dispatches destroy-session', async () => {
    const deps = makeMockDeps();
    deps.workspaceService.findBySessionPrefix = vi.fn().mockReturnValue({ id: 'ws1', name: 'ws' });
    const dispatcher = new CommandDispatcher(deps);

    const result = await dispatcher.dispatch('destroy-session', { session: 'ws/repo/_dir' });
    expect(result.success).toBe(true);
    expect(deps.tmux.killSession).toHaveBeenCalledWith('ws/repo/_dir');
  });

  it('dispatches get-branches', async () => {
    const deps = makeMockDeps();
    const dispatcher = new CommandDispatcher({ ...deps, isAllowedDirectory: () => true });

    const result = await dispatcher.dispatch('get-branches', { repoRoot: '/tmp/repo' });
    expect(result.success).toBe(true);
    expect(deps.git.listBranches).toHaveBeenCalledWith('/tmp/repo');
  });

  it('dispatches discover-repos', async () => {
    const deps = makeMockDeps();
    const dispatcher = new CommandDispatcher({ ...deps, isAllowedDirectory: () => true });

    const result = await dispatcher.dispatch('discover-repos', { directory: '/tmp' });
    expect(result.success).toBe(true);
    expect(deps.workspaceService.discoverGitRepos).toHaveBeenCalledWith('/tmp', 3);
  });

  it('dispatches list-windows and returns ordered live windows for a session', async () => {
    const deps = makeMockDeps();
    deps.workspaceService.findBySessionPrefix = vi.fn().mockReturnValue({ id: 'ws1', name: 'ws' });
    deps.workspaceService.getPersistedSessions = vi.fn().mockReturnValue([
      {
        tmuxSession: 'ws/repo/_dir',
        type: 'directory',
        directory: '/tmp',
        // Persisted order puts Logs before Editor
        windows: [{ name: 'Logs' }, { name: 'Editor' }],
      },
    ]);
    deps.tmux.listWindows = vi.fn().mockResolvedValue([
      { index: 0, name: 'Editor', active: false },
      { index: 1, name: 'Logs', active: true },
    ]);
    const dispatcher = new CommandDispatcher(deps);

    const result = await dispatcher.dispatch('list-windows', { session: 'ws/repo/_dir' });
    expect(result.success).toBe(true);
    expect(deps.tmux.listWindows).toHaveBeenCalledWith('ws/repo/_dir');
    expect(result.data).toEqual([
      { index: 1, name: 'Logs', active: true },
      { index: 0, name: 'Editor', active: false },
    ]);
  });

  it('dispatches select-window for a known session', async () => {
    const deps = makeMockDeps();
    deps.workspaceService.findBySessionPrefix = vi.fn().mockReturnValue({ id: 'ws1', name: 'ws' });
    const dispatcher = new CommandDispatcher(deps);

    const result = await dispatcher.dispatch('select-window', { session: 'ws/repo/_dir', window: 'Logs' });
    expect(result.success).toBe(true);
    expect(deps.tmux.selectWindow).toHaveBeenCalledWith('ws/repo/_dir', 'Logs');
  });

  it('dispatches new-window for a known session and selects it', async () => {
    const deps = makeMockDeps();
    deps.workspaceService.findBySessionPrefix = vi.fn().mockReturnValue({ id: 'ws1', name: 'ws' });
    deps.tmux.displayMessage = vi.fn().mockResolvedValue('/srv/repo\n');
    const dispatcher = new CommandDispatcher(deps);

    const result = await dispatcher.dispatch('new-window', { session: 'ws/repo/_dir', name: 'Notes' });
    expect(result.success).toBe(true);
    expect(deps.tmux.newWindow).toHaveBeenCalledWith('ws/repo/_dir', 'Notes', '/srv/repo');
    expect(deps.tmux.selectWindow).toHaveBeenCalledWith('ws/repo/_dir', 'Notes');
  });

  it('dispatches kill-window for a known session', async () => {
    const deps = makeMockDeps();
    deps.workspaceService.findBySessionPrefix = vi.fn().mockReturnValue({ id: 'ws1', name: 'ws' });
    deps.tmux.listWindows = vi.fn().mockResolvedValue([
      { index: 0, name: 'Editor', active: true },
      { index: 1, name: 'Logs', active: false },
    ]);
    const dispatcher = new CommandDispatcher(deps);

    const result = await dispatcher.dispatch('kill-window', { session: 'ws/repo/_dir', windowIndex: 1 });
    expect(result.success).toBe(true);
    expect(deps.tmux.killWindow).toHaveBeenCalledWith('ws/repo/_dir', 1);
  });

  it('dispatches kill-window for the last remaining window by killing the session', async () => {
    const deps = makeMockDeps();
    deps.workspaceService.findBySessionPrefix = vi.fn().mockReturnValue({ id: 'ws1', name: 'ws' });
    deps.tmux.listWindows = vi.fn().mockResolvedValue([
      { index: 0, name: 'Editor', active: true },
    ]);
    const dispatcher = new CommandDispatcher(deps);

    const result = await dispatcher.dispatch('kill-window', { session: 'ws/repo/_dir', windowIndex: 0 });
    expect(result.success).toBe(true);
    expect(deps.tmux.killSession).toHaveBeenCalledWith('ws/repo/_dir');
    expect(deps.tmux.killWindow).not.toHaveBeenCalled();
  });

  it('dispatches set-window-order and persists it', async () => {
    const deps = makeMockDeps();
    deps.workspaceService.findBySessionPrefix = vi.fn().mockReturnValue({ id: 'ws1', name: 'ws' });
    const dispatcher = new CommandDispatcher(deps);

    const result = await dispatcher.dispatch('set-window-order', {
      session: 'ws/repo/_dir',
      names: ['Logs', 'Editor'],
    });
    expect(result.success).toBe(true);
    expect(deps.workspaceService.setSessionWindowOrder).toHaveBeenCalledWith(
      'ws1',
      'ws/repo/_dir',
      ['Logs', 'Editor'],
    );
  });

  it('returns error for unknown command', async () => {
    const deps = makeMockDeps();
    const dispatcher = new CommandDispatcher(deps);

    const result = await dispatcher.dispatch('unknown-command', {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown command');
  });

  it('catches service errors and returns a sanitised category to the client', async () => {
    const deps = makeMockDeps();
    deps.stateService.collectWorkspaces = vi.fn().mockRejectedValue(new Error('tmux not found at /tmp/internal/path'));
    const dispatcher = new CommandDispatcher(deps);

    const result = await dispatcher.dispatch('get-state', {});
    expect(result.success).toBe(false);
    // Raw filesystem path / internals must NOT leak to the client.
    expect(result.error).not.toContain('/tmp');
    expect(result.error).not.toContain('tmux not found');
    // Categorised messages allowed:
    expect(['Not found', 'Invalid argument', 'Internal error']).toContain(result.error);
  });

  // ── Backend-aware dispatch (native-supervisor sessions) ────────────────
  describe('backend dispatch', () => {
    function withNativePersisted(deps: ReturnType<typeof makeMockDeps>, sessionId = 'ws/repo/_dir') {
      deps.workspaceService.findBySessionPrefix = vi.fn().mockReturnValue({ id: 'ws1', name: 'ws' });
      deps.workspaceService.findPersistedBackend = vi.fn().mockReturnValue('native');
      deps.workspaceService.getPersistedSessions = vi.fn().mockReturnValue([
        { tmuxSession: sessionId, type: 'directory', directory: '/srv/repo', windows: [{ name: 'shell', kind: 'command', command: '', directory: '/srv/repo' }], backend: 'native' },
      ]);
      return sessionId;
    }

    it('wake-session routes to supervisor.wakeSession when supervisor already owns the session', async () => {
      const deps = makeMockDeps();
      const session = withNativePersisted(deps);
      deps.supervisor.hasSession = vi.fn().mockReturnValue(true);
      deps.supervisor.listWindows = vi.fn().mockReturnValue([{ id: 'w0', name: 'shell', spec: {}, state: 'running', exitCode: null }]);
      const dispatcher = new CommandDispatcher(deps);

      const result = await dispatcher.dispatch('wake-session', { session });

      expect(result.success).toBe(true);
      expect(deps.supervisor.wakeSession).toHaveBeenCalledWith(session);
      expect(deps.supervisor.createSession).not.toHaveBeenCalled();
      expect(deps.sessionService.restoreSession).not.toHaveBeenCalled();
    });

    it('wake-session routes to supervisor.createSession when supervisor has no session', async () => {
      const deps = makeMockDeps();
      const session = withNativePersisted(deps);
      deps.supervisor.hasSession = vi.fn().mockReturnValue(false);
      deps.supervisor.listWindows = vi.fn().mockReturnValue([{ id: 'w0', name: 'shell', spec: {}, state: 'running', exitCode: null }]);
      const dispatcher = new CommandDispatcher(deps);

      const result = await dispatcher.dispatch('wake-session', { session });

      expect(result.success).toBe(true);
      expect(deps.supervisor.createSession).toHaveBeenCalledWith(expect.objectContaining({
        sessionId: session,
        cwd: '/srv/repo',
      }));
      expect(deps.sessionService.restoreSession).not.toHaveBeenCalled();
    });

    it('sleep-session routes to supervisor.sleepSession for native sessions', async () => {
      const deps = makeMockDeps();
      const session = withNativePersisted(deps);
      deps.supervisor.hasSession = vi.fn().mockReturnValue(true);
      const dispatcher = new CommandDispatcher(deps);

      const result = await dispatcher.dispatch('sleep-session', { session });

      expect(result.success).toBe(true);
      expect(deps.supervisor.sleepSession).toHaveBeenCalledWith(session);
      expect(deps.tmux.killSession).not.toHaveBeenCalled();
    });

    it('destroy-session routes to supervisor.killSession for native sessions and removes persisted entry', async () => {
      const deps = makeMockDeps();
      const session = withNativePersisted(deps);
      deps.supervisor.hasSession = vi.fn().mockReturnValue(true);
      const dispatcher = new CommandDispatcher(deps);

      const result = await dispatcher.dispatch('destroy-session', { session });

      expect(result.success).toBe(true);
      expect(deps.supervisor.killSession).toHaveBeenCalledWith(session);
      expect(deps.tmux.killSession).not.toHaveBeenCalled();
      expect(deps.workspaceService.removeSession).toHaveBeenCalledWith('ws1', session);
    });

    it('select-window routes to supervisor for native sessions, looking up by name', async () => {
      const deps = makeMockDeps();
      const session = withNativePersisted(deps);
      deps.supervisor.listWindows = vi.fn().mockReturnValue([
        { id: 'w0', name: 'shell', spec: {}, state: 'running', exitCode: null },
        { id: 'w1', name: 'editor', spec: {}, state: 'running', exitCode: null },
      ]);
      const dispatcher = new CommandDispatcher(deps);

      const result = await dispatcher.dispatch('select-window', { session, window: 'editor' });

      expect(result.success).toBe(true);
      expect(deps.supervisor.selectWindow).toHaveBeenCalledWith(session, 'w1');
      expect(deps.tmux.selectWindow).not.toHaveBeenCalled();
    });

    it('new-window routes to supervisor.addWindow + selectWindow for native sessions', async () => {
      const deps = makeMockDeps();
      const session = withNativePersisted(deps);
      const dispatcher = new CommandDispatcher(deps);

      const result = await dispatcher.dispatch('new-window', { session, name: 'logs' });

      expect(result.success).toBe(true);
      expect(deps.supervisor.addWindow).toHaveBeenCalledWith(session, expect.objectContaining({ name: 'logs' }));
      expect(deps.supervisor.selectWindow).toHaveBeenCalledWith(session, 'w-id');
      expect(deps.tmux.newWindow).not.toHaveBeenCalled();
    });

    it('kill-window routes to supervisor.killWindow for native sessions when more than one window', async () => {
      const deps = makeMockDeps();
      const session = withNativePersisted(deps);
      deps.supervisor.listWindows = vi.fn().mockReturnValue([
        { id: 'w0', name: 'shell', spec: {}, state: 'running', exitCode: null },
        { id: 'w1', name: 'editor', spec: {}, state: 'running', exitCode: null },
      ]);
      const dispatcher = new CommandDispatcher(deps);

      const result = await dispatcher.dispatch('kill-window', { session, windowIndex: 1 });

      expect(result.success).toBe(true);
      expect(deps.supervisor.killWindow).toHaveBeenCalledWith(session, 'w1');
      expect(deps.supervisor.killSession).not.toHaveBeenCalled();
      expect(deps.tmux.killWindow).not.toHaveBeenCalled();
    });

    it('kill-window of last native window kills the session', async () => {
      const deps = makeMockDeps();
      const session = withNativePersisted(deps);
      deps.supervisor.listWindows = vi.fn().mockReturnValue([
        { id: 'w0', name: 'shell', spec: {}, state: 'running', exitCode: null },
      ]);
      const dispatcher = new CommandDispatcher(deps);

      const result = await dispatcher.dispatch('kill-window', { session, windowIndex: 0 });

      expect(result.success).toBe(true);
      expect(deps.supervisor.killSession).toHaveBeenCalledWith(session);
      expect(deps.supervisor.killWindow).not.toHaveBeenCalled();
    });

    it('list-windows returns supervisor windows for native sessions', async () => {
      const deps = makeMockDeps();
      const session = withNativePersisted(deps);
      deps.supervisor.listWindows = vi.fn().mockReturnValue([
        { id: 'w0', name: 'shell', spec: {}, state: 'running', exitCode: null },
        { id: 'w1', name: 'editor', spec: {}, state: 'running', exitCode: null },
      ]);
      const dispatcher = new CommandDispatcher(deps);

      const result = await dispatcher.dispatch('list-windows', { session });

      expect(result.success).toBe(true);
      expect(result.data).toEqual([
        { index: 0, name: 'shell', active: false },
        { index: 1, name: 'editor', active: false },
      ]);
      expect(deps.tmux.listWindows).not.toHaveBeenCalled();
    });

    it('create-repo-session worktree mode creates the worktree and launches at the worktree path', async () => {
      const deps = makeMockDeps();
      deps.workspaceService.list = vi.fn().mockReturnValue([{ id: 'ws1', name: 'Dev', directory: '/srv/dev' }]);
      deps.git.getWorktreeDir = vi.fn().mockReturnValue('/srv/worktrees/repo');
      deps.sessionService.getSessionName = vi.fn().mockReturnValue('Dev/repo/feat-x');
      deps.sessionLauncher.launch = vi.fn().mockResolvedValue({ sessionId: 'Dev/repo/feat-x', backend: 'tmux' });
      const dispatcher = new CommandDispatcher({ ...deps, isAllowedDirectory: () => true });

      const result = await dispatcher.dispatch('create-repo-session', {
        workspaceName: 'Dev',
        repoRoot: '/srv/repo',
        mode: 'worktree',
        branch: 'feat-x',
        base: 'origin/main',
      });

      expect(result.success).toBe(true);
      expect(deps.worktreeService.create).toHaveBeenCalledWith({
        repo: 'repo',
        repoRoot: '/srv/repo',
        branch: 'feat-x',
        base: 'origin/main',
      });
      expect(deps.sessionLauncher.launch).toHaveBeenCalledWith(
        'Dev/repo/feat-x',
        '/srv/worktrees/repo/feat-x',
        expect.any(Array),
      );
      expect(deps.workspaceService.persistSession).toHaveBeenCalledWith('ws1', expect.objectContaining({
        type: 'worktree',
        branch: 'feat-x',
        repoRoot: '/srv/repo',
      }));
    });

    it('create-repo-session worktree mode without a branch returns an error', async () => {
      const deps = makeMockDeps();
      const dispatcher = new CommandDispatcher({ ...deps, isAllowedDirectory: () => true });

      const result = await dispatcher.dispatch('create-repo-session', {
        workspaceName: 'Dev',
        repoRoot: '/srv/repo',
        mode: 'worktree',
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Invalid argument|Branch/);
      expect(deps.worktreeService.create).not.toHaveBeenCalled();
    });

    it('rejects a malicious branch (path traversal / shell injection chars) before any side effects', async () => {
      const deps = makeMockDeps();
      const dispatcher = new CommandDispatcher({ ...deps, isAllowedDirectory: () => true });

      const malicious = ["../escape", "x'; rm -rf /; '", "feat\nwith-newline", "-rf"];
      for (const branch of malicious) {
        const result = await dispatcher.dispatch('create-repo-session', {
          workspaceName: 'Dev',
          repoRoot: '/srv/repo',
          mode: 'worktree',
          branch,
          base: 'origin/main',
        });
        expect(result.success).toBe(false);
        expect(deps.worktreeService.create).not.toHaveBeenCalled();
        expect(deps.sessionLauncher.launch).not.toHaveBeenCalled();
      }
    });

    it('rejects malicious workspaceName / label / dir before any side effects', async () => {
      const deps = makeMockDeps();
      const dispatcher = new CommandDispatcher({ ...deps, isAllowedDirectory: () => true });

      // Slash-containing workspace name (would corrupt session id).
      let result = await dispatcher.dispatch('create-workspace-session', {
        workspaceName: 'Dev/escape',
        workspaceDir: '/srv/dev',
      });
      expect(result.success).toBe(false);

      // Newline in label.
      result = await dispatcher.dispatch('create-standalone-session', {
        label: 'scratch\ninjected',
        dir: '/tmp',
      });
      expect(result.success).toBe(false);

      // Empty repoRoot for create-repo-session.
      result = await dispatcher.dispatch('create-repo-session', {
        workspaceName: 'Dev',
        repoRoot: '',
        mode: 'directory',
      });
      expect(result.success).toBe(false);

      expect(deps.sessionLauncher.launch).not.toHaveBeenCalled();
    });

    it('isAllowedDirectory denial prevents the session from being created', async () => {
      const deps = makeMockDeps();
      const dispatcher = new CommandDispatcher({ ...deps, isAllowedDirectory: () => false });

      const result = await dispatcher.dispatch('create-workspace-session', {
        workspaceName: 'Dev',
        workspaceDir: '/etc',
      });
      expect(result.success).toBe(false);
      expect(deps.sessionLauncher.launch).not.toHaveBeenCalled();
    });

    it('create-workspace-session routes through sessionLauncher (not sessionService)', async () => {
      const deps = makeMockDeps();
      deps.workspaceService.list = vi.fn().mockReturnValue([{ id: 'ws1', name: 'test', directory: '/tmp' }]);
      deps.sessionLauncher.launch = vi.fn().mockResolvedValue({ sessionId: 'test/_ws', backend: 'native' });
      const dispatcher = new CommandDispatcher({ ...deps, isAllowedDirectory: () => true });

      const result = await dispatcher.dispatch('create-workspace-session', {
        workspaceName: 'test',
        workspaceDir: '/tmp',
      });

      expect(result.success).toBe(true);
      expect(deps.sessionLauncher.launch).toHaveBeenCalled();
      expect(deps.sessionService.launchSession).not.toHaveBeenCalled();
      expect(deps.workspaceService.persistSession).toHaveBeenCalledWith('ws1', expect.objectContaining({
        backend: 'native',
        type: 'workspace',
      }));
    });
  });
});
