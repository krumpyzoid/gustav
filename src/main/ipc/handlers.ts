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
import type { CreateWorktreeParams, CleanTarget, Result } from '../domain/types';

function ok<T>(data: T): Result<T> {
  return { success: true, data };
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
}): void {
  const { worktreeService, sessionService, stateService, themeService, workspaceService, configService, tmux, git, getPtyClientTty, getActiveSession, setActiveSession } = deps;

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

  // ── Session commands ────────────────────────────────────────
  ipcMain.handle(Channels.SWITCH_SESSION, async (_event, session: string) => {
    try {
      const tty = await getPtyClientTty();
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
      return ok(undefined);
    } catch (e) {
      return err((e as Error).message);
    }
  });

  ipcMain.handle(Channels.CREATE_WORKSPACE_SESSION, async (_event, workspaceName: string, workspaceDir: string, label?: string) => {
    try {
      const config = await configService.parse(workspaceDir);
      const session = await sessionService.launchWorkspaceSession(workspaceName, workspaceDir, config, label);
      const tty = await getPtyClientTty();
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

      if (mode === 'directory') {
        session = await sessionService.launchDirectorySession(workspaceName, repoRoot, config);
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
      }

      const tty = await getPtyClientTty();
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
      const tty = await getPtyClientTty();
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
      } else {
        await tmux.killWindow(session, windowIndex);
      }
      return ok(undefined);
    } catch (e) {
      return err((e as Error).message);
    }
  });
}
