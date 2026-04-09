import { ipcMain, dialog, BrowserWindow } from 'electron';
import { Channels } from './channels';
import type { WorktreeService } from '../services/worktree.service';
import type { SessionService } from '../services/session.service';
import type { StateService } from '../services/state.service';
import type { ThemeService } from '../services/theme.service';
import type { RegistryService } from '../services/registry.service';
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
  registryService: RegistryService;
  configService: ConfigService;
  tmux: TmuxPort;
  git: GitPort;
  getPtyClientTty: () => Promise<string | null>;
  getActiveSession: () => string | null;
  setActiveSession: (session: string) => void;
}): void {
  const { worktreeService, sessionService, stateService, themeService, registryService, configService, tmux, git, getPtyClientTty, getActiveSession, setActiveSession } = deps;

  // ── Queries ──────────────────────────────────────────────────
  ipcMain.handle(Channels.GET_STATE, async () => {
    return stateService.collect(getActiveSession() ?? undefined);
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

  // ── Commands ─────────────────────────────────────────────────
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

  ipcMain.handle(Channels.CREATE_SESSION, async (_event, name: string) => {
    try {
      await tmux.newSession(name, { windowName: 'Shell', cwd: process.env.HOME! });
      const tty = await getPtyClientTty();
      if (tty) {
        await sessionService.switchTo(name, tty);
        setActiveSession(name);
      }
      return ok(undefined);
    } catch (e) {
      return err((e as Error).message);
    }
  });

  ipcMain.handle(Channels.START_SESSION, async (_event, session: string, workdir: string) => {
    try {
      const slashIdx = session.indexOf('/');
      if (slashIdx === -1) return err('Invalid session name');
      const repo = session.slice(0, slashIdx);
      const branch = session.slice(slashIdx + 1);

      const registry = registryService.load();
      const repoRoot = registry[repo];
      if (!repoRoot) return err(`Repo '${repo}' not found in registry`);

      const config = await configService.parse(repoRoot);
      await sessionService.launch(repoRoot, branch, workdir, config);

      const tty = await getPtyClientTty();
      if (tty) {
        await sessionService.switchTo(session, tty);
        setActiveSession(session);
      }
      return ok(undefined);
    } catch (e) {
      return err((e as Error).message);
    }
  });

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

  ipcMain.handle(Channels.PIN_PROJECTS, async () => {
    try {
      const win = BrowserWindow.getFocusedWindow();
      if (!win) return ok([]);
      const result = await dialog.showOpenDialog(win, {
        properties: ['openDirectory'],
        title: 'Select a project folder',
      });
      if (result.canceled || result.filePaths.length === 0) return ok([]);
      const folderPath = result.filePaths[0];
      const repos = registryService.discoverGitRepos(folderPath, 3);
      if (repos.length > 0) {
        await registryService.pinMany(repos);
      }
      return ok(repos);
    } catch (e) {
      return err((e as Error).message);
    }
  });

  ipcMain.handle(Channels.UNPIN_PROJECT, async (_event, repoName: string) => {
    try {
      await registryService.remove(repoName);
      return ok(undefined);
    } catch (e) {
      return err((e as Error).message);
    }
  });

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
