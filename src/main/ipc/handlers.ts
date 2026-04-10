import { ipcMain, dialog, BrowserWindow } from 'electron';
import { Channels } from './channels';
import type { WorktreeService } from '../services/worktree.service';
import type { SessionService } from '../services/session.service';
import type { StateService } from '../services/state.service';
import type { ThemeService } from '../services/theme.service';
import type { WorkspaceService } from '../services/workspace.service';
import type { ConfigService } from '../services/config.service';
import type { GitPort } from '../ports/git.port';
import type { TmuxPort } from '../ports/tmux.port';
import type { CreateWorktreeParams, CleanTarget, Result, PersistedSession, SessionType } from '../domain/types';

function ok<T>(data: T): Result<T> {
  return { success: true, data };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function err(message: string): Result<never> {
  return { success: false, error: message };
}

export function registerHandlers(deps: {
  worktreeService: WorktreeService;
  sessionService: SessionService;
  stateService: StateService;
  themeService: ThemeService;
  workspaceService: WorkspaceService;
  configService: ConfigService;
  tmux: TmuxPort;
  git: GitPort;
  getPtyClientTty: () => Promise<string | null>;
  getActiveSession: () => string | null;
  setActiveSession: (session: string) => void;
  ensurePty: () => void;
}): void {
  const { worktreeService, sessionService, stateService, themeService, workspaceService, configService, tmux, git, getPtyClientTty, getActiveSession, setActiveSession, ensurePty } = deps;

  // ── Queries ──────────────────────────────────────────────────
  ipcMain.handle(Channels.GET_STATE, async () => {
    return stateService.collectWorkspaces(getActiveSession() ?? undefined);
  });

  ipcMain.handle(Channels.GET_THEME, () => {
    return themeService.load();
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
            const config = await configService.parse(repoRoot);
            const session = await sessionService.launchDirectorySession(ws.name, repoRoot, config);
            const windows = ['Claude Code', 'Git', 'Shell', ...config.tmux.map((e: string) => e.split(':')[0])];
            await workspaceService.persistSession(ws.id, { tmuxSession: session, type: 'directory', directory: repoRoot, windows });
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
        const repoName = require('node:path').basename(repoPath);
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
      ensurePty();
      // Brief wait for tmux client to register after PTY (re)start
      let tty = await getPtyClientTty();
      if (!tty) { await sleep(200); tty = await getPtyClientTty(); }
      if (!tty) return err('No PTY client TTY available');
      await sessionService.switchTo(session, tty);
      setActiveSession(session);
      const windows = await tmux.listWindows(session);
      return ok(windows);
    } catch (e) {
      return err((e as Error).message);
    }
  });

  ipcMain.handle(Channels.KILL_SESSION, async (_event, session: string) => {
    try {
      await tmux.killSession(session);
      // Remove from persisted sessions
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
      const config = await configService.parse(workspaceDir);
      const session = await sessionService.launchWorkspaceSession(workspaceName, workspaceDir, config, label);
      // Persist session definition
      const ws = workspaceService.findBySessionPrefix(session);
      if (ws) {
        const windows = ['Claude Code', 'Shell', ...config.tmux.map((e) => e.split(':')[0])];
        await workspaceService.persistSession(ws.id, { tmuxSession: session, type: 'workspace', directory: workspaceDir, windows });
      }
      ensurePty();
      let tty = await getPtyClientTty();
      if (!tty) { await sleep(200); tty = await getPtyClientTty(); }
      if (tty) {
        await sessionService.switchTo(session, tty);
        setActiveSession(session);
      }
      return ok(session);
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
    install?: boolean,
  ) => {
    try {
      const config = await configService.parse(repoRoot);
      let session: string;

      let sessionType: SessionType;
      let sessionDir: string;
      if (mode === 'directory') {
        session = await sessionService.launchDirectorySession(workspaceName, repoRoot, config);
        sessionType = 'directory';
        sessionDir = repoRoot;
      } else {
        if (!branch) return err('Branch name required for worktree session');
        // Create worktree first
        await worktreeService.create({
          repo: require('node:path').basename(repoRoot),
          repoRoot,
          branch,
          base: base ?? config.base ?? 'origin/main',
          install: install ?? false,
        });
        const wtPath = require('node:path').join(git.getWorktreeDir(repoRoot), branch);
        session = await sessionService.launchWorktreeSession(workspaceName, repoRoot, branch, wtPath, config);
        sessionType = 'worktree';
        sessionDir = wtPath;
      }

      // Persist session definition
      const ws = workspaceService.findBySessionPrefix(session);
      if (ws) {
        const windows = ['Claude Code', 'Git', 'Shell', ...config.tmux.map((e) => e.split(':')[0])];
        await workspaceService.persistSession(ws.id, { tmuxSession: session, type: sessionType, directory: sessionDir, windows });
      }

      ensurePty();
      let tty = await getPtyClientTty();
      if (!tty) { await sleep(200); tty = await getPtyClientTty(); }
      if (tty) {
        await sessionService.switchTo(session, tty);
        setActiveSession(session);
      }
      return ok(session);
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
      const config = await configService.parse(repoRoot);
      const session = await sessionService.launchWorktreeSession(workspaceName, repoRoot, branch, worktreePath, config);
      // Persist session definition
      const ws = workspaceService.findBySessionPrefix(session);
      if (ws) {
        const windows = ['Claude Code', 'Git', 'Shell', ...config.tmux.map((e) => e.split(':')[0])];
        await workspaceService.persistSession(ws.id, { tmuxSession: session, type: 'worktree', directory: worktreePath, windows });
      }
      ensurePty();
      let tty = await getPtyClientTty();
      if (!tty) { await sleep(200); tty = await getPtyClientTty(); }
      if (tty) {
        await sessionService.switchTo(session, tty);
        setActiveSession(session);
      }
      return ok(session);
    } catch (e) {
      return err((e as Error).message);
    }
  });

  ipcMain.handle(Channels.CREATE_STANDALONE_SESSION, async (_event, label: string, dir: string) => {
    try {
      const session = await sessionService.launchStandaloneSession(label, dir);
      ensurePty();
      let tty = await getPtyClientTty();
      if (!tty) { await sleep(200); tty = await getPtyClientTty(); }
      if (tty) {
        await sessionService.switchTo(session, tty);
        setActiveSession(session);
      }
      return ok(session);
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

  // (Legacy CREATE_SESSION and START_SESSION removed — use workspace/repo/standalone session handlers)

  // ── Worktree commands ───────────────────────────────────────
  ipcMain.handle(Channels.CREATE_WORKTREE, async (_event, params: CreateWorktreeParams) => {
    try {
      await worktreeService.create(params);
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
      await tmux.selectWindow(session, window);
      return ok(undefined);
    } catch (e) {
      return err((e as Error).message);
    }
  });

  ipcMain.handle(Channels.NEW_WINDOW, async (_event, session: string, name: string) => {
    try {
      const cwd = (await tmux.displayMessage(`${session}:0`, '#{pane_current_path}')).trim() || process.env.HOME!;
      await tmux.newWindow(session, name, cwd);
      await tmux.selectWindow(session, name);
      // Update persisted window list
      const ws = workspaceService.findBySessionPrefix(session);
      if (ws) {
        const updatedWindows = await tmux.listWindows(session);
        const existing = workspaceService.getPersistedSessions(ws.id).find((s) => s.tmuxSession === session);
        if (existing) {
          await workspaceService.persistSession(ws.id, { ...existing, windows: updatedWindows.map((w) => w.name) });
        }
      }
      return ok(undefined);
    } catch (e) {
      return err((e as Error).message);
    }
  });

  ipcMain.handle(Channels.KILL_WINDOW, async (_event, session: string, windowIndex: number) => {
    try {
      const windows = await tmux.listWindows(session);
      if (windows.length <= 1) {
        await tmux.killSession(session);
        const ws = workspaceService.findBySessionPrefix(session);
        if (ws) await workspaceService.removeSession(ws.id, session);
      } else {
        await tmux.killWindow(session, windowIndex);
        // Update persisted window list
        const ws = workspaceService.findBySessionPrefix(session);
        if (ws) {
          const updatedWindows = await tmux.listWindows(session);
          const existing = workspaceService.getPersistedSessions(ws.id).find((s) => s.tmuxSession === session);
          if (existing) {
            await workspaceService.persistSession(ws.id, { ...existing, windows: updatedWindows.map((w) => w.name) });
          }
        }
      }
      return ok(undefined);
    } catch (e) {
      return err((e as Error).message);
    }
  });
}
