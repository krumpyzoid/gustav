import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionLifecycleService } from '../session-lifecycle.service';
import type { WorkspaceService } from '../workspace.service';
import type { SessionService } from '../session.service';
import type { SessionLauncherService } from '../session-launcher.service';
import type { WorktreeService } from '../worktree.service';
import type { RepoConfigService } from '../repo-config.service';
import type { PreferenceService } from '../preference.service';
import type { SessionSupervisorPort } from '../../supervisor/supervisor.port';
import type { GitPort } from '../../ports/git.port';
import type { TmuxPort } from '../../ports/tmux.port';

function makeDeps() {
  const workspaceService = {
    list: vi.fn().mockReturnValue([]),
    findBySessionPrefix: vi.fn().mockReturnValue(null),
    findPersistedBackend: vi.fn().mockReturnValue(null),
    findClaudeSessionId: vi.fn().mockReturnValue(undefined),
    resolveBackend: vi.fn().mockReturnValue('tmux'),
    getPersistedSessions: vi.fn().mockReturnValue([]),
    persistSession: vi.fn(),
    removeSession: vi.fn(),
    setSessionWindowOrder: vi.fn().mockResolvedValue(undefined),
  } as unknown as WorkspaceService;

  const sessionService = {
    getSessionName: vi.fn((_ws, opts) => {
      if (opts.type === 'directory') return `Dev/${opts.repoName}/_dir`;
      if (opts.type === 'worktree') return `Dev/${opts.repoName}/${opts.branch}`;
      return `Dev/${opts.label ?? '_ws'}`;
    }),
    restoreSession: vi.fn().mockResolvedValue(undefined),
    launchSession: vi.fn().mockResolvedValue('Dev/_ws'),
  } as unknown as SessionService;

  const sessionLauncher = {
    launch: vi.fn().mockResolvedValue({ sessionId: 'Dev/_ws', backend: 'tmux' }),
  } as unknown as SessionLauncherService;

  const worktreeService = {
    create: vi.fn().mockResolvedValue(undefined),
  } as unknown as WorktreeService;

  const repoConfigService = {
    get: vi.fn().mockReturnValue(null),
  } as unknown as RepoConfigService;

  const preferenceService = {
    load: vi.fn().mockReturnValue({ defaultTabs: [] }),
  } as unknown as PreferenceService;

  const supervisor = {
    hasSession: vi.fn().mockReturnValue(false),
    listWindows: vi.fn().mockReturnValue([]),
    listSessions: vi.fn().mockReturnValue([]),
    createSession: vi.fn().mockResolvedValue(undefined),
    sleepSession: vi.fn().mockResolvedValue(undefined),
    wakeSession: vi.fn().mockResolvedValue(undefined),
    killSession: vi.fn().mockResolvedValue(undefined),
    addWindow: vi.fn().mockResolvedValue('w-1'),
    selectWindow: vi.fn().mockResolvedValue(undefined),
    killWindow: vi.fn().mockResolvedValue(undefined),
  } as unknown as SessionSupervisorPort;

  const git = {
    getWorktreeDir: vi.fn().mockReturnValue('/srv/worktrees'),
    listBranches: vi.fn().mockResolvedValue([]),
  } as unknown as GitPort;

  const tmux = {
    hasSession: vi.fn().mockResolvedValue(false),
    killSession: vi.fn().mockResolvedValue(undefined),
    listWindows: vi.fn().mockResolvedValue([]),
    selectWindow: vi.fn().mockResolvedValue(undefined),
    newWindow: vi.fn().mockResolvedValue(undefined),
    killWindow: vi.fn().mockResolvedValue(undefined),
    displayMessage: vi.fn().mockResolvedValue(''),
  } as unknown as TmuxPort;

  return { workspaceService, sessionService, sessionLauncher, worktreeService, repoConfigService, preferenceService, supervisor, git, tmux };
}

describe('SessionLifecycleService — wake', () => {
  it('returns null when no persisted session exists', async () => {
    const deps = makeDeps();
    const svc = new SessionLifecycleService(deps);
    const r = await svc.wake('NoSuch/_dir');
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toBeNull();
  });

  it('routes to supervisor.wakeSession for native when supervisor already owns the session', async () => {
    const deps = makeDeps();
    deps.workspaceService.findBySessionPrefix = vi.fn().mockReturnValue({ id: 'ws1', name: 'Dev' });
    deps.workspaceService.getPersistedSessions = vi.fn().mockReturnValue([
      { tmuxSession: 'Dev/_ws', type: 'workspace', directory: '/srv/dev', windows: [], backend: 'native' },
    ]);
    deps.workspaceService.resolveBackend = vi.fn().mockReturnValue('native');
    deps.supervisor.hasSession = vi.fn().mockReturnValue(true);

    const svc = new SessionLifecycleService(deps);
    const r = await svc.wake('Dev/_ws');

    expect(r.success).toBe(true);
    expect(deps.supervisor.wakeSession).toHaveBeenCalledWith('Dev/_ws');
    expect(deps.supervisor.createSession).not.toHaveBeenCalled();
  });

  it('routes to sessionService.restoreSession for tmux backend and returns null windows (caller fetches)', async () => {
    const deps = makeDeps();
    deps.workspaceService.findBySessionPrefix = vi.fn().mockReturnValue({ id: 'ws1', name: 'Dev' });
    deps.workspaceService.getPersistedSessions = vi.fn().mockReturnValue([
      { tmuxSession: 'Dev/repo/_dir', type: 'directory', directory: '/srv/repo', windows: [] },
    ]);
    deps.workspaceService.resolveBackend = vi.fn().mockReturnValue('tmux');

    const svc = new SessionLifecycleService(deps);
    const r = await svc.wake('Dev/repo/_dir');

    expect(r.success).toBe(true);
    if (r.success && r.data) {
      expect(r.data.backend).toBe('tmux');
      expect(r.data.windows).toBeNull();
    }
    expect(deps.sessionService.restoreSession).toHaveBeenCalled();
  });
});

describe('SessionLifecycleService — sleep / destroy', () => {
  it('sleep is a no-op for native sessions when supervisor.hasSession is false', async () => {
    const deps = makeDeps();
    deps.workspaceService.resolveBackend = vi.fn().mockReturnValue('native');
    deps.supervisor.hasSession = vi.fn().mockReturnValue(false);

    const svc = new SessionLifecycleService(deps);
    await svc.sleep('Dev/_ws');

    expect(deps.supervisor.sleepSession).not.toHaveBeenCalled();
  });

  it('destroy removes the persisted entry even if the session was already gone', async () => {
    const deps = makeDeps();
    deps.workspaceService.findBySessionPrefix = vi.fn().mockReturnValue({ id: 'ws1', name: 'Dev' });
    deps.tmux.hasSession = vi.fn().mockResolvedValue(false);

    const svc = new SessionLifecycleService(deps);
    await svc.destroy('Dev/_ws');

    expect(deps.tmux.killSession).not.toHaveBeenCalled();
    expect(deps.workspaceService.removeSession).toHaveBeenCalledWith('ws1', 'Dev/_ws');
  });
});

describe('SessionLifecycleService — kill window', () => {
  beforeEach(() => {});

  it('reports wasLastWindow=true when killing the only window kills the whole session', async () => {
    const deps = makeDeps();
    deps.workspaceService.resolveBackend = vi.fn().mockReturnValue('tmux');
    deps.tmux.listWindows = vi.fn().mockResolvedValue([{ index: 0, name: 'shell', active: true }]);

    const svc = new SessionLifecycleService(deps);
    const r = await svc.killWindow('Dev/_ws', 0);

    expect(r.success).toBe(true);
    if (r.success) expect(r.data.wasLastWindow).toBe(true);
    expect(deps.tmux.killSession).toHaveBeenCalledWith('Dev/_ws');
    expect(deps.tmux.killWindow).not.toHaveBeenCalled();
  });

  it('reports wasLastWindow=false when killing a non-last tmux window', async () => {
    const deps = makeDeps();
    deps.workspaceService.resolveBackend = vi.fn().mockReturnValue('tmux');
    deps.tmux.listWindows = vi.fn().mockResolvedValue([
      { index: 0, name: 'shell', active: true },
      { index: 1, name: 'logs', active: false },
    ]);

    const svc = new SessionLifecycleService(deps);
    const r = await svc.killWindow('Dev/_ws', 1);

    expect(r.success).toBe(true);
    if (r.success) expect(r.data.wasLastWindow).toBe(false);
    expect(deps.tmux.killWindow).toHaveBeenCalledWith('Dev/_ws', 1);
  });
});

describe('SessionLifecycleService — create', () => {
  it('createWorkspaceSession injects the previous Claude session id into windows', async () => {
    const deps = makeDeps();
    deps.workspaceService.list = vi.fn().mockReturnValue([{ id: 'ws1', name: 'Dev', directory: '/srv/dev' }]);
    deps.workspaceService.findClaudeSessionId = vi.fn().mockReturnValue('claude-uuid-xyz');

    const svc = new SessionLifecycleService(deps);
    const r = await svc.createWorkspaceSession({ workspaceName: 'Dev', workspaceDir: '/srv/dev' });

    expect(r.success).toBe(true);
    expect(deps.workspaceService.findClaudeSessionId).toHaveBeenCalled();
    expect(deps.sessionLauncher.launch).toHaveBeenCalled();
  });

  it('createWorkspaceSession rejects with friendly error when name already exists', async () => {
    const deps = makeDeps();
    deps.workspaceService.list = vi.fn().mockReturnValue([{ id: 'ws1', name: 'Dev', directory: '/srv/dev' }]);
    deps.tmux.hasSession = vi.fn().mockResolvedValue(true);

    const svc = new SessionLifecycleService(deps);
    const r = await svc.createWorkspaceSession({ workspaceName: 'Dev', workspaceDir: '/srv/dev', label: 'scratch' });

    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toMatch(/already exists/);
    expect(deps.sessionLauncher.launch).not.toHaveBeenCalled();
  });

  it('createRepoSession worktree mode creates the worktree and launches at the worktree path', async () => {
    const deps = makeDeps();
    deps.workspaceService.list = vi.fn().mockReturnValue([{ id: 'ws1', name: 'Dev', directory: '/srv/dev' }]);
    deps.git.getWorktreeDir = vi.fn().mockReturnValue('/srv/worktrees/repo');
    deps.sessionLauncher.launch = vi.fn().mockResolvedValue({ sessionId: 'Dev/repo/feat', backend: 'tmux' });

    const svc = new SessionLifecycleService(deps);
    const r = await svc.createRepoSession({
      workspaceName: 'Dev',
      repoRoot: '/srv/repo',
      mode: 'worktree',
      branch: 'feat',
      base: 'origin/main',
    });

    expect(r.success).toBe(true);
    expect(deps.worktreeService.create).toHaveBeenCalledWith({
      repo: 'repo',
      repoRoot: '/srv/repo',
      branch: 'feat',
      base: 'origin/main',
    });
    expect(deps.sessionLauncher.launch).toHaveBeenCalledWith(
      expect.any(String),
      '/srv/worktrees/repo/feat',
      expect.any(Array),
    );
    expect(deps.workspaceService.persistSession).toHaveBeenCalledWith(
      'ws1',
      expect.objectContaining({ type: 'worktree', branch: 'feat', repoRoot: '/srv/repo' }),
    );
  });

  it('createRepoSession worktree mode without a branch returns an error', async () => {
    const deps = makeDeps();
    const svc = new SessionLifecycleService(deps);

    const r = await svc.createRepoSession({
      workspaceName: 'Dev',
      repoRoot: '/srv/repo',
      mode: 'worktree',
    });

    expect(r.success).toBe(false);
    expect(deps.worktreeService.create).not.toHaveBeenCalled();
  });

  it('createStandaloneSession launches but does not persist (no workspace context)', async () => {
    const deps = makeDeps();
    deps.sessionLauncher.launch = vi.fn().mockResolvedValue({ sessionId: '_standalone/scratch', backend: 'tmux' });

    const svc = new SessionLifecycleService(deps);
    const r = await svc.createStandaloneSession({ label: 'scratch', dir: '/tmp/s' });

    expect(r.success).toBe(true);
    expect(deps.sessionLauncher.launch).toHaveBeenCalled();
    expect(deps.workspaceService.persistSession).not.toHaveBeenCalled();
  });
});
