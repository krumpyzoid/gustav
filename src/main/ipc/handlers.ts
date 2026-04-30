import { ipcMain, dialog, BrowserWindow } from 'electron';
import { basename, join } from 'node:path';
import { Channels } from './channels';
import type { WorktreeService } from '../services/worktree.service';
import type { SessionService } from '../services/session.service';
import type { SessionLauncherService } from '../services/session-launcher.service';
import type { StateService } from '../services/state.service';
import type { ThemeService } from '../services/theme.service';
import type { WorkspaceService } from '../services/workspace.service';
import type { RepoConfigService } from '../services/repo-config.service';
import type { GitPort } from '../ports/git.port';
import type { TmuxPort } from '../ports/tmux.port';
import type { ShellPort } from '../ports/shell.port';
import type { PreferenceService } from '../services/preference.service';
import type { SessionSupervisorPort } from '../supervisor/supervisor.port';
import type { CreateWorktreeParams, CleanTarget, Result, PersistedSession, SessionType, Preferences, WindowSpec, SessionBackend, WindowInfo } from '../domain/types';
import type { TabConfig } from '../domain/tab-config';
import { snapshotSessionWindows } from './snapshot-windows';
import { buildWindowSpecs } from './build-window-specs';
import { applyPersistedWindowOrder } from './apply-persisted-window-order';
import { ok, err } from '../domain/result-helpers';
import { supervisorWindowsAsInfo as supWindowsAsInfo } from '../supervisor/supervisor-utils';

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isTabConfigArray(v: unknown): v is TabConfig[] {
  if (!Array.isArray(v)) return false;
  return v.every((t) => {
    if (typeof t !== 'object' || t === null) return false;
    const tab = t as Record<string, unknown>;
    if (typeof tab.id !== 'string' || typeof tab.name !== 'string') return false;
    if (tab.kind !== 'claude' && tab.kind !== 'command') return false;
    if (
      tab.appliesTo !== 'standalone' &&
      tab.appliesTo !== 'repository' &&
      tab.appliesTo !== 'both'
    ) return false;
    return true;
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}


export function registerHandlers(deps: {
  worktreeService: WorktreeService;
  sessionService: SessionService;
  /** Phase 3 strangler: chooses tmux vs native at session creation time. */
  sessionLauncher: SessionLauncherService;
  /** Phase 3 strangler: native-supervisor instance, used for sleep/wake/destroy
   * dispatch when a session's persisted backend is `'native'`. */
  supervisor: SessionSupervisorPort;
  stateService: StateService;
  themeService: ThemeService;
  workspaceService: WorkspaceService;
  repoConfigService: RepoConfigService;
  tmux: TmuxPort;
  shell: ShellPort;
  git: GitPort;
  getPtyClientTty: () => Promise<string | null>;
  getActiveSession: () => string | null;
  setActiveSession: (session: string) => void;
  preferenceService: PreferenceService;
  ensurePty: () => void;
  broadcastTheme: () => void;
  remoteService?: import('../remote/remote.service').RemoteService;
  remoteClientService?: import('../remote/remote-client.service').RemoteClientService;
  broadcastToRenderer?: (channel: string, ...args: unknown[]) => void;
}): void {
  const { worktreeService, sessionService, sessionLauncher, supervisor, stateService, themeService, workspaceService, repoConfigService, preferenceService, tmux, shell, git, getPtyClientTty, getActiveSession, setActiveSession, ensurePty, broadcastTheme, remoteService, remoteClientService, broadcastToRenderer } = deps;

  /** Backend lookup delegates to the shared workspaceService helper so
   * the local IPC handler and remote dispatcher cannot drift on the
   * `?? 'tmux'` default. */
  function backendOf(sessionId: string): SessionBackend {
    return workspaceService.resolveBackend(sessionId);
  }

  /** Bind the shared `supervisorWindowsAsInfo` helper to this scope's
   * supervisor so call sites stay terse. */
  function supervisorWindowsAsInfo(sessionId: string): WindowInfo[] {
    return supWindowsAsInfo(supervisor, sessionId);
  }

  /** Ensure PTY is running, switch tmux client to the given session, and mark it active. */
  async function switchAfterPty(session: string): Promise<void> {
    ensurePty();
    let tty = await getPtyClientTty();
    if (!tty) { await sleep(200); tty = await getPtyClientTty(); }
    if (tty) {
      await sessionService.switchTo(session, tty);
      setActiveSession(session);
    }
  }

  /** Return live tmux windows ordered by the user's saved visual order, falling back to tmux index order. */
  async function getOrderedWindows(session: string) {
    const live = await tmux.listWindows(session);
    const ws = workspaceService.findBySessionPrefix(session);
    if (!ws) return live;
    const persisted = workspaceService.getPersistedSessions(ws.id).find((s) => s.tmuxSession === session);
    return applyPersistedWindowOrder(live, persisted?.windows ?? []);
  }

  /** Snapshot current tmux windows and persist to workspace storage. */
  async function snapshotAndPersist(session: string): Promise<void> {
    const ws = workspaceService.findBySessionPrefix(session);
    if (!ws) return;
    const existing = workspaceService.getPersistedSessions(ws.id).find((s) => s.tmuxSession === session);
    if (!existing) return;
    const windows = await snapshotSessionWindows(tmux, session, existing.windows, shell);
    await workspaceService.persistSession(ws.id, { ...existing, windows });
  }

  // ── Queries ──────────────────────────────────────────────────
  ipcMain.handle(Channels.GET_STATE, async () => {
    return stateService.collectWorkspaces(getActiveSession() ?? undefined);
  });

  ipcMain.handle(Channels.GET_THEME, () => {
    return themeService.resolve();
  });

  ipcMain.handle(Channels.GET_BRANCHES, async (_event, repoRoot: string) => {
    return git.listBranches(repoRoot);
  });

  ipcMain.handle(Channels.GET_CLEAN_CANDIDATES, async () => {
    return worktreeService.getCleanCandidates();
  });

  ipcMain.handle(Channels.DISCOVER_REPOS, async (_event, directory: string) => {
    try {
      const repos = workspaceService.discoverGitRepos(directory, 3);
      return ok(repos);
    } catch (e) {
      return err((e as Error).message);
    }
  });

  // ── Workspace commands ──────────────────────────────────────
  ipcMain.handle(Channels.CREATE_WORKSPACE, async (_event, name: string, directory: string) => {
    try {
      const ws = await workspaceService.create(name, directory);
      return ok(ws);
    } catch (e) {
      return err((e as Error).message);
    }
  });

  ipcMain.handle(Channels.RENAME_WORKSPACE, async (_event, id: string, newName: string) => {
    try {
      await workspaceService.rename(id, newName);
      return ok(undefined);
    } catch (e) {
      return err((e as Error).message);
    }
  });

  ipcMain.handle(Channels.REMOVE_WORKSPACE, async (_event, id: string) => {
    try {
      await workspaceService.remove(id);
      return ok(undefined);
    } catch (e) {
      return err((e as Error).message);
    }
  });

  ipcMain.handle(Channels.DELETE_WORKSPACE, async (_event, id: string, deleteWorktrees: boolean) => {
    try {
      const ws = workspaceService.list().find((w) => w.id === id);
      if (!ws) return err('Workspace not found');

      // Kill all tmux sessions belonging to this workspace
      const sessions = await tmux.listSessions();
      for (const s of sessions) {
        if (s.startsWith(`${ws.name}/`)) {
          try { await tmux.killSession(s); } catch {}
        }
      }

      // Optionally remove worktrees from disk
      if (deleteWorktrees && ws.pinnedRepos) {
        for (const repo of ws.pinnedRepos) {
          try {
            const wtDir = git.getWorktreeDir(repo.path);
            const worktrees = await git.listWorktrees(repo.path, wtDir);
            for (const wt of worktrees) {
              if (wt.branch) {
                try { await worktreeService.remove(repo.path, wt.branch, false); } catch {}
              }
            }
          } catch {}
        }
      }

      // Remove the workspace from storage
      await workspaceService.remove(id);
      return ok(undefined);
    } catch (e) {
      return err((e as Error).message);
    }
  });

  ipcMain.handle(Channels.REORDER_WORKSPACES, async (_event, ids: string[]) => {
    try {
      await workspaceService.reorder(ids);
      return ok(undefined);
    } catch (e) {
      return err((e as Error).message);
    }
  });

  ipcMain.handle(Channels.REORDER_WITHIN_WORKSPACE, async (_event, workspaceId: string, ordering: Record<string, unknown>) => {
    try {
      await workspaceService.updateOrdering(workspaceId, ordering);
      return ok(undefined);
    } catch (e) {
      return err((e as Error).message);
    }
  });

  // ── Pin/unpin repos ─────────────────────────────────────────
  ipcMain.handle(Channels.PIN_REPOS, async (_event, workspaceId: string, repoPaths: string[]) => {
    try {
      const ws = workspaceService.list().find((w) => w.id === workspaceId);
      await workspaceService.pinRepos(workspaceId, repoPaths);
      // Auto-create directory sessions for newly pinned repos
      if (ws) {
        for (const repoRoot of repoPaths) {
          try {
            const repoName = basename(repoRoot);
            const sessionName = sessionService.getSessionName(ws.name, { type: 'directory', repoName });
            const prevClaudeId = workspaceService.findClaudeSessionId(sessionName);
            const windows = buildWindowSpecs({
              type: 'directory',
              workspace: ws,
              preferences: preferenceService.load(),
              repoConfig: repoConfigService.get(repoRoot),
              claudeSessionId: prevClaudeId,
            });
            const launched = await sessionLauncher.launch(sessionName, repoRoot, windows);
            await workspaceService.persistSession(ws.id, { tmuxSession: launched.sessionId, type: 'directory', directory: repoRoot, windows, backend: launched.backend });
          } catch {}
        }
        ensurePty();
      }
      return ok(undefined);
    } catch (e) {
      return err((e as Error).message);
    }
  });

  ipcMain.handle(Channels.UNPIN_REPO, async (_event, workspaceId: string, repoPath: string) => {
    try {
      // Find workspace to build session name prefix
      const ws = workspaceService.list().find((w) => w.id === workspaceId);
      if (ws) {
        const repoName = basename(repoPath);
        const prefix = `${ws.name}/${repoName}/`;
        // Kill all tmux sessions for this repo (directory + worktrees)
        const sessions = await tmux.listSessions();
        for (const s of sessions) {
          if (s.startsWith(prefix) || s === `${ws.name}/${repoName}/_dir`) {
            try { await tmux.killSession(s); } catch {}
          }
        }
      }
      await workspaceService.unpinRepo(workspaceId, repoPath);
      return ok(undefined);
    } catch (e) {
      return err((e as Error).message);
    }
  });

  // ── Session commands ────────────────────────────────────────
  ipcMain.handle(Channels.SWITCH_SESSION, async (_event, session: string) => {
    try {
      const backend = backendOf(session);
      if (backend === 'native') {
        // Native sessions stream PTY data through SUPERVISOR_ON_DATA; the
        // legacy tmux PTY stays alive for tmux-backed sessions.
        setActiveSession(session);
        return ok(supervisorWindowsAsInfo(session));
      }
      ensurePty();
      // Brief wait for tmux client to register after PTY (re)start
      let tty = await getPtyClientTty();
      if (!tty) { await sleep(200); tty = await getPtyClientTty(); }
      if (!tty) return err('No PTY client TTY available');
      await sessionService.switchTo(session, tty);
      setActiveSession(session);
      const windows = await getOrderedWindows(session);
      return ok(windows);
    } catch (e) {
      return err((e as Error).message);
    }
  });

  ipcMain.handle(Channels.SLEEP_SESSION, async (_event, session: string) => {
    try {
      const backend = backendOf(session);
      if (backend === 'native') {
        if (supervisor.hasSession(session)) await supervisor.sleepSession(session);
        return ok(undefined);
      }
      await snapshotAndPersist(session);
      if (await tmux.hasSession(session)) {
        await tmux.killSession(session);
      }
      return ok(undefined);
    } catch (e) {
      return err((e as Error).message);
    }
  });

  ipcMain.handle(Channels.WAKE_SESSION, async (_event, session: string) => {
    try {
      const backend = backendOf(session);
      // Restore session from persisted snapshot (preserves user-created windows and commands)
      const ws = workspaceService.findBySessionPrefix(session);
      if (ws) {
        const persisted = workspaceService.getPersistedSessions(ws.id).find((s) => s.tmuxSession === session);
        if (persisted) {
          if (backend === 'native') {
            // If the supervisor still owns the session it was sleeping —
            // wake spawns fresh PTYs from the retained spec. Otherwise
            // (e.g. after a Gustav restart) recreate from persisted spec.
            if (supervisor.hasSession(session)) {
              await supervisor.wakeSession(session);
            } else {
              await supervisor.createSession({
                sessionId: session,
                cwd: persisted.directory,
                windows: persisted.windows,
              });
            }
            setActiveSession(session);
            return ok(supervisorWindowsAsInfo(session));
          }
          await sessionService.restoreSession(persisted);
          await switchAfterPty(session);
          const windows = await getOrderedWindows(session);
          return ok(windows);
        }
      }
      return err('No persisted session found');
    } catch (e) {
      return err((e as Error).message);
    }
  });

  ipcMain.handle(Channels.DESTROY_SESSION, async (_event, session: string) => {
    try {
      const backend = backendOf(session);
      if (backend === 'native') {
        if (supervisor.hasSession(session)) await supervisor.killSession(session);
      } else if (await tmux.hasSession(session)) {
        await tmux.killSession(session);
      }
      // Remove the persisted session entry permanently (for both backends).
      const ws = workspaceService.findBySessionPrefix(session);
      if (ws) {
        await workspaceService.removeSession(ws.id, session);
      }
      return ok(undefined);
    } catch (e) {
      return err((e as Error).message);
    }
  });

  ipcMain.handle(Channels.CREATE_WORKSPACE_SESSION, async (_event, workspaceName: string, workspaceDir: string, label?: string) => {
    try {
      const sessionName = sessionService.getSessionName(workspaceName, { type: 'workspace', label });
      if (await tmux.hasSession(sessionName) || supervisor.hasSession(sessionName)) {
        return err(`Session "${label ?? '_ws'}" already exists in workspace "${workspaceName}"`);
      }
      const prevClaudeId = workspaceService.findClaudeSessionId(sessionName);
      const ws = workspaceService.list().find((w) => w.name === workspaceName) ?? null;
      const windows = buildWindowSpecs({
        type: 'workspace',
        workspace: ws,
        preferences: preferenceService.load(),
        repoConfig: null,
        claudeSessionId: prevClaudeId,
      });
      const launched = await sessionLauncher.launch(sessionName, workspaceDir, windows);
      if (ws) {
        await workspaceService.persistSession(ws.id, { tmuxSession: launched.sessionId, type: 'workspace', directory: workspaceDir, windows, backend: launched.backend });
      }
      // tmux switch is meaningful only for tmux-backed sessions; native
      // sessions stream PTY data through the supervisor IPC channel.
      if (launched.backend === 'tmux') {
        await switchAfterPty(launched.sessionId);
      } else {
        setActiveSession(launched.sessionId);
      }
      return ok(launched.sessionId);
    } catch (e) {
      return err((e as Error).message);
    }
  });

  ipcMain.handle(Channels.CREATE_REPO_SESSION, async (
    _event,
    workspaceName: string,
    repoRoot: string,
    mode: 'directory' | 'worktree',
    branch?: string,
    base?: string,
  ) => {
    try {
      const repoName = basename(repoRoot);
      let sessionType: SessionType;
      let sessionDir: string;
      let sessionName: string;

      if (mode === 'directory') {
        sessionType = 'directory';
        sessionDir = repoRoot;
        sessionName = sessionService.getSessionName(workspaceName, { type: 'directory', repoName });
      } else {
        if (!branch) return err('Branch name required for worktree session');
        await worktreeService.create({
          repo: repoName,
          repoRoot,
          branch,
          base: base ?? repoConfigService.get(repoRoot)?.baseBranch ?? 'origin/main',
        });
        sessionType = 'worktree';
        sessionDir = join(git.getWorktreeDir(repoRoot), branch);
        sessionName = sessionService.getSessionName(workspaceName, { type: 'worktree', repoName, branch });
      }

      const prevClaudeId = workspaceService.findClaudeSessionId(sessionName);
      const ws = workspaceService.list().find((w) => w.name === workspaceName) ?? null;
      const windows = buildWindowSpecs({
        type: sessionType,
        workspace: ws,
        preferences: preferenceService.load(),
        repoConfig: repoConfigService.get(repoRoot),
        claudeSessionId: prevClaudeId,
      });
      const launched = await sessionLauncher.launch(sessionName, sessionDir, windows);

      if (ws) {
        await workspaceService.persistSession(ws.id, { tmuxSession: launched.sessionId, type: sessionType, directory: sessionDir, windows, backend: launched.backend });
      }

      if (launched.backend === 'tmux') {
        await switchAfterPty(launched.sessionId);
      } else {
        setActiveSession(launched.sessionId);
      }
      return ok(launched.sessionId);
    } catch (e) {
      return err((e as Error).message);
    }
  });

  ipcMain.handle(Channels.LAUNCH_WORKTREE_SESSION, async (
    _event,
    workspaceName: string,
    repoRoot: string,
    branch: string,
    worktreePath: string,
  ) => {
    try {
      const repoName = basename(repoRoot);
      const sessionName = sessionService.getSessionName(workspaceName, { type: 'worktree', repoName, branch });
      const prevClaudeId = workspaceService.findClaudeSessionId(sessionName);
      const ws = workspaceService.list().find((w) => w.name === workspaceName) ?? null;
      const windows = buildWindowSpecs({
        type: 'worktree',
        workspace: ws,
        preferences: preferenceService.load(),
        repoConfig: repoConfigService.get(repoRoot),
        claudeSessionId: prevClaudeId,
      });
      const launched = await sessionLauncher.launch(sessionName, worktreePath, windows);
      if (ws) {
        await workspaceService.persistSession(ws.id, { tmuxSession: launched.sessionId, type: 'worktree', directory: worktreePath, windows, backend: launched.backend });
      }
      if (launched.backend === 'tmux') {
        await switchAfterPty(launched.sessionId);
      } else {
        setActiveSession(launched.sessionId);
      }
      return ok(launched.sessionId);
    } catch (e) {
      return err((e as Error).message);
    }
  });

  ipcMain.handle(Channels.CREATE_STANDALONE_SESSION, async (_event, label: string, dir: string) => {
    try {
      const sessionName = sessionService.getSessionName(null, { type: 'workspace', label });
      const windows = buildWindowSpecs({
        type: 'workspace',
        workspace: null,
        preferences: preferenceService.load(),
        repoConfig: null,
      });
      const launched = await sessionLauncher.launch(sessionName, dir, windows);
      // Standalone sessions aren't persisted — there's no workspace to attach
      // them to. The backend choice is still respected for runtime dispatch
      // (the session shows up in the supervisor.listSessions() union path).
      if (launched.backend === 'tmux') {
        await switchAfterPty(launched.sessionId);
      } else {
        setActiveSession(launched.sessionId);
      }
      return ok(launched.sessionId);
    } catch (e) {
      return err((e as Error).message);
    }
  });

  ipcMain.handle(Channels.SELECT_DIRECTORY, async () => {
    try {
      const win = BrowserWindow.getFocusedWindow();
      if (!win) return ok(null);
      const result = await dialog.showOpenDialog(win, {
        properties: ['openDirectory'],
        title: 'Select a directory',
      });
      if (result.canceled || result.filePaths.length === 0) return ok(null);
      return ok(result.filePaths[0]);
    } catch (e) {
      return err((e as Error).message);
    }
  });

  // ── Worktree commands ───────────────────────────────────────
  ipcMain.handle(Channels.CREATE_WORKTREE, async (_event, params: CreateWorktreeParams) => {
    try {
      await worktreeService.create(params);
      const wtPath = join(git.getWorktreeDir(params.repoRoot), params.branch);
      const sessionName = sessionService.getSessionName(null, {
        type: 'worktree',
        repoName: basename(params.repoRoot),
        branch: params.branch,
      });
      const windows = buildWindowSpecs({
        type: 'worktree',
        workspace: null,
        preferences: preferenceService.load(),
        repoConfig: repoConfigService.get(params.repoRoot),
      });
      await sessionLauncher.launch(sessionName, wtPath, windows);
      return ok(undefined);
    } catch (e) {
      return err((e as Error).message);
    }
  });

  ipcMain.handle(Channels.REMOVE_WORKTREE, async (_event, repoRoot: string, branch: string, deleteBranch: boolean) => {
    try {
      await worktreeService.remove(repoRoot, branch, deleteBranch);
      return ok(undefined);
    } catch (e) {
      return err((e as Error).message);
    }
  });

  ipcMain.handle(Channels.CLEAN_WORKTREES, async (_event, items: CleanTarget[]) => {
    try {
      const report = await worktreeService.clean(items);
      return ok(report);
    } catch (e) {
      return err((e as Error).message);
    }
  });

  // ── Window commands ─────────────────────────────────────────
  ipcMain.handle(Channels.SELECT_WINDOW, async (_event, session: string, window: string) => {
    try {
      const backend = backendOf(session);
      if (backend === 'native') {
        // Find the supervisor's window id by display name.
        const w = supervisor.listWindows(session).find((mw) => mw.name === window);
        if (!w) return err(`Window "${window}" not found in session "${session}"`);
        await supervisor.selectWindow(session, w.id);
        return ok(undefined);
      }
      await tmux.selectWindow(session, window);
      return ok(undefined);
    } catch (e) {
      return err((e as Error).message);
    }
  });

  ipcMain.handle(Channels.NEW_WINDOW, async (_event, session: string, name: string) => {
    try {
      const backend = backendOf(session);
      if (backend === 'native') {
        // Inherit the session's cwd; the supervisor doesn't expose a
        // `pane_current_path` equivalent, so we use the persisted directory.
        const ws = workspaceService.findBySessionPrefix(session);
        const persisted = ws
          ? workspaceService.getPersistedSessions(ws.id).find((s) => s.tmuxSession === session)
          : undefined;
        const cwd = persisted?.directory ?? process.env.HOME!;
        const spec: WindowSpec = { name, kind: 'command', command: '', directory: cwd };
        const newId = await supervisor.addWindow(session, spec);
        await supervisor.selectWindow(session, newId);
        // Persist the updated window list.
        if (ws && persisted) {
          await workspaceService.persistSession(ws.id, {
            ...persisted,
            windows: [...persisted.windows, spec],
          });
        }
        return ok(undefined);
      }
      const cwd = (await tmux.displayMessage(`${session}:0`, '#{pane_current_path}')).trim() || process.env.HOME!;
      await tmux.newWindow(session, name, cwd);
      await tmux.selectWindow(session, name);
      await snapshotAndPersist(session);
      return ok(undefined);
    } catch (e) {
      return err((e as Error).message);
    }
  });

  ipcMain.handle(Channels.KILL_WINDOW, async (_event, session: string, windowIndex: number) => {
    try {
      const backend = backendOf(session);
      if (backend === 'native') {
        const windows = supervisor.listWindows(session);
        const target = windows[windowIndex];
        if (!target) return err(`Window index ${windowIndex} out of range for session "${session}"`);
        if (windows.length <= 1) {
          await supervisor.killSession(session);
          // Persisted session is intentionally kept for resume.
        } else {
          await supervisor.killWindow(session, target.id);
          // Persist the truncated window list.
          const ws = workspaceService.findBySessionPrefix(session);
          const persisted = ws
            ? workspaceService.getPersistedSessions(ws.id).find((s) => s.tmuxSession === session)
            : undefined;
          if (ws && persisted) {
            await workspaceService.persistSession(ws.id, {
              ...persisted,
              windows: persisted.windows.filter((w) => w.name !== target.name),
            });
          }
        }
        return ok(undefined);
      }
      const windows = await tmux.listWindows(session);
      if (windows.length <= 1) {
        await tmux.killSession(session);
        // Persisted session is intentionally kept for resume.
      } else {
        await tmux.killWindow(session, windowIndex);
        await snapshotAndPersist(session);
      }
      return ok(undefined);
    } catch (e) {
      return err((e as Error).message);
    }
  });

  ipcMain.handle(Channels.SET_WINDOW_ORDER, async (_event, session: string, names: unknown) => {
    try {
      if (typeof session !== 'string' || !session) return err('Invalid session');
      if (!Array.isArray(names) || !names.every((n) => typeof n === 'string')) {
        return err('Invalid names payload');
      }
      const ws = workspaceService.findBySessionPrefix(session);
      if (!ws) return err('Workspace not found for session');
      // Persist for both backends. The native supervisor doesn't expose a
      // window-reorder primitive yet (Phase 3 follow-up): the renderer renders
      // in persisted order, so the on-disk order is the source of truth and
      // the supervisor's internal list order doesn't need to match.
      await workspaceService.setSessionWindowOrder(ws.id, session, names as string[]);
      return ok(undefined);
    } catch (e) {
      return err((e as Error).message);
    }
  });

  // ── Preferences ─────────────────────────────────────────────────
  ipcMain.handle(Channels.GET_PREFERENCES, () => {
    return preferenceService.load();
  });

  ipcMain.handle(Channels.SET_PREFERENCE, (_event, key: keyof Preferences, value: unknown) => {
    const prefs = preferenceService.set(key, value as any);
    if (key === 'theme') broadcastTheme();
    return prefs;
  });

  ipcMain.handle(Channels.SET_DEFAULT_TABS, (_event, tabs: unknown) => {
    if (!isTabConfigArray(tabs)) return err('Invalid tabs payload');
    preferenceService.setDefaultTabs(tabs);
    return ok(preferenceService.load());
  });

  ipcMain.handle(Channels.SET_WORKSPACE_DEFAULT_TABS, async (_event, workspaceId: string, tabs: unknown) => {
    if (tabs !== null && !isTabConfigArray(tabs)) return err('Invalid tabs payload');
    try {
      await workspaceService.setDefaultTabs(workspaceId, tabs);
      return ok(undefined);
    } catch (e) {
      return err((e as Error).message);
    }
  });

  // ── Repo config ────────────────────────────────────────────────────
  ipcMain.handle(Channels.GET_REPO_CONFIG, (_event, repoRoot: string) => {
    return repoConfigService.get(repoRoot);
  });

  ipcMain.handle(Channels.SET_REPO_CONFIG, async (_event, repoRoot: string, config: unknown) => {
    if (config !== null && !isPlainObject(config)) return err('Invalid config payload');
    try {
      await repoConfigService.set(repoRoot, config as never);
      return ok(undefined);
    } catch (e) {
      return err((e as Error).message);
    }
  });

  // ── Remote server commands ────────────────────────────────────────
  ipcMain.handle(Channels.ENABLE_REMOTE, async (_event, port: number) => {
    if (!remoteService) return err('Remote service not available');
    try {
      await remoteService.start(port);
      return ok(remoteService.getHostInfo());
    } catch (e) {
      return err((e as Error).message);
    }
  });

  ipcMain.handle(Channels.DISABLE_REMOTE, async () => {
    if (!remoteService) return err('Remote service not available');
    try {
      await remoteService.stop();
      return ok(undefined);
    } catch (e) {
      return err((e as Error).message);
    }
  });

  ipcMain.handle(Channels.GET_HOST_INFO, () => {
    if (!remoteService) return err('Remote service not available');
    return ok(remoteService.getHostInfo());
  });

  ipcMain.handle(Channels.DISCONNECT_REMOTE_CLIENT, () => {
    if (!remoteService) return err('Remote service not available');
    remoteService.disconnectClient();
    return ok(undefined);
  });

  ipcMain.handle(Channels.REGENERATE_PAIRING_CODE, () => {
    if (!remoteService) return err('Remote service not available');
    remoteService.regenerateCode();
    return ok(remoteService.getHostInfo());
  });

  // ── Remote client commands ──────────────────────────────────────────
  // Remote PTY input/resize (fire-and-forget, like local PTY)
  ipcMain.on(Channels.REMOTE_PTY_INPUT, (_event, channelId: number, data: string) => {
    remoteClientService?.sendPtyInput(channelId, data);
  });

  ipcMain.on(Channels.REMOTE_PTY_RESIZE, (_event, channelId: number, cols: number, rows: number) => {
    remoteClientService?.sendPtyResize(channelId, cols, rows);
  });

  ipcMain.handle(Channels.CONNECT_REMOTE, async (_event, host: string, port: number, code: string) => {
    if (!remoteClientService) return err('Remote client service not available');
    try {
      await remoteClientService.connect(`wss://${host}:${port}`);
      // Send pairing auth
      remoteClientService.sendAuth({ method: 'pair', code });
      return ok(undefined);
    } catch (e) {
      return err((e as Error).message);
    }
  });

  ipcMain.handle(Channels.DISCONNECT_REMOTE, () => {
    if (!remoteClientService) return err('Remote client service not available');
    remoteClientService.disconnect();
    return ok(undefined);
  });

  ipcMain.handle(Channels.GET_REMOTE_STATE, () => {
    if (!remoteClientService) return err('Remote client service not available');
    return ok({ status: remoteClientService.getConnectionStatus() });
  });

  ipcMain.handle(Channels.REMOTE_SESSION_COMMAND, async (_event, action: string, params: Record<string, unknown>) => {
    if (!remoteClientService) return err('Remote client service not available');
    try {
      // Only the binary-channel PTY data plane is fire-and-forget — those
      // frames flow over the binary WebSocket channel and have no response.
      // Every other command (lifecycle, window ops, creation, queries)
      // round-trips so the renderer can react to server-side success/error.
      if (action === 'detach-pty' || action === 'resize-pty') {
        remoteClientService.sendCommand(action, params);
        return ok(undefined);
      }
      // Server emits a Result-shaped payload — return it directly so the
      // renderer sees the server's success/error rather than the IPC bridge's.
      // Wrapping in another `ok(response)` would double-wrap the envelope.
      return await remoteClientService.sendCommandAndWait(action, params);
    } catch (e) {
      return err((e as Error).message);
    }
  });

  ipcMain.handle(Channels.FORWARD_PORT, async (_event, remotePort: number, localPort?: number) => {
    if (!remoteClientService) return err('Remote client service not available');
    try {
      const result = await remoteClientService.forwardPort(remotePort, localPort ?? remotePort, remotePort);
      return result.success ? ok({ localPort: localPort ?? remotePort }) : err(result.error ?? 'Failed to forward port');
    } catch (e) {
      return err((e as Error).message);
    }
  });

  ipcMain.handle(Channels.STOP_FORWARD, (_event, channelId: number) => {
    if (!remoteClientService) return err('Remote client service not available');
    remoteClientService.stopForward(channelId);
    return ok(undefined);
  });

  ipcMain.handle(Channels.GET_SAVED_SERVERS, () => {
    if (!remoteClientService) return err('Remote client service not available');
    return ok(remoteClientService.getSavedServers());
  });

  ipcMain.handle(Channels.DELETE_SAVED_SERVER, (_event, id: string) => {
    if (!remoteClientService) return err('Remote client service not available');
    remoteClientService.deleteSavedServer(id);
    return ok(undefined);
  });

  ipcMain.handle(Channels.CONNECT_SAVED_SERVER, async (_event, id: string) => {
    if (!remoteClientService) return err('Remote client service not available');
    try {
      const servers = remoteClientService.getSavedServers();
      const server = servers.find((s) => s.id === id);
      if (!server) return err('Saved server not found');
      await remoteClientService.connectToSaved(server);
      return ok(undefined);
    } catch (e) {
      return err((e as Error).message);
    }
  });
}
