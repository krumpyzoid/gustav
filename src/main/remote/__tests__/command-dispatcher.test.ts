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
    getPersistedSessions: vi.fn().mockReturnValue([]),
    persistSession: vi.fn(),
    removeSession: vi.fn(),
    discoverGitRepos: vi.fn().mockReturnValue([]),
  } as unknown as WorkspaceService;

  const tmux = {
    hasSession: vi.fn().mockResolvedValue(true),
    killSession: vi.fn(),
    listWindows: vi.fn().mockResolvedValue([]),
  } as unknown as TmuxPort;

  const repoConfigService = {
    get: vi.fn().mockReturnValue(null),
  } as unknown as import('../../services/repo-config.service').RepoConfigService;

  const preferenceService = {
    load: vi.fn().mockReturnValue({ defaultTabs: [] }),
  } as unknown as import('../../services/preference.service').PreferenceService;

  const git = {
    listBranches: vi.fn().mockResolvedValue([]),
  } as unknown as GitPort;

  return { stateService, sessionService, workspaceService, tmux, repoConfigService, preferenceService, git };
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
    const dispatcher = new CommandDispatcher(deps);

    const result = await dispatcher.dispatch('get-branches', { repoRoot: '/tmp/repo' });
    expect(result.success).toBe(true);
    expect(deps.git.listBranches).toHaveBeenCalledWith('/tmp/repo');
  });

  it('dispatches discover-repos', async () => {
    const deps = makeMockDeps();
    const dispatcher = new CommandDispatcher(deps);

    const result = await dispatcher.dispatch('discover-repos', { directory: '/tmp' });
    expect(result.success).toBe(true);
    expect(deps.workspaceService.discoverGitRepos).toHaveBeenCalledWith('/tmp', 3);
  });

  it('returns error for unknown command', async () => {
    const deps = makeMockDeps();
    const dispatcher = new CommandDispatcher(deps);

    const result = await dispatcher.dispatch('unknown-command', {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown command');
  });

  it('catches service errors and returns them as Result', async () => {
    const deps = makeMockDeps();
    deps.stateService.collectWorkspaces = vi.fn().mockRejectedValue(new Error('tmux not found'));
    const dispatcher = new CommandDispatcher(deps);

    const result = await dispatcher.dispatch('get-state', {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('tmux not found');
  });
});
