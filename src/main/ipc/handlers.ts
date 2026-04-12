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
import type { PreferenceService } from '../services/preference.service';
import type { CreateWorktreeParams, CleanTarget, Result, PersistedSession, SessionType, Preferences, WindowSpec } from '../domain/types';
import { normalizeWindows } from '../domain/types';

function ok<T>(data: T): Result<T> {
  return { success: true, data };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function err(message: string): Result<never> {
  return { success: false, error: message };
}

function buildWindowSpecs(
  type: 'workspace' | 'directory' | 'worktree',
  gustavTmuxEntries: string[],
  claudeSessionId?: string,
): WindowSpec[] {
  const specs: WindowSpec[] = [{ name: 'Claude Code', command: 'claude', ...(claudeSessionId ? { claudeSessionId } : {}) }];

  if (type === 'directory' || type === 'worktree') {
    specs.push({ name: 'Git', command: 'lazygit' });
  }

  specs.push({ name: 'Shell' });

  for (const entry of gustavTmuxEntries) {
    const colonIdx = entry.indexOf(':');
    const name = colonIdx > -1 ? entry.slice(0, colonIdx) : entry;
    const cmd = colonIdx > -1 ? entry.slice(colonIdx + 1) : undefined;
    specs.push(cmd ? { name, command: cmd } : { name });
  }

  return specs;
}

/** Look up the Claude session ID from a previously persisted session. */
function findClaudeSessionId(workspaceService: WorkspaceService, session: string): string | undefined {
  const ws = workspaceService.findBySessionPrefix(session);
  if (!ws) return undefined;
  const persisted = workspaceService.getPersistedSessions(ws.id).find((s) => s.tmuxSession === session);
  if (!persisted) return undefined;
  const specs = normalizeWindows(persisted.windows);
  const claude = specs.find((s) => s.name === 'Claude Code');
  return claude?.claudeSessionId;
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
  preferenceService: PreferenceService;
  ensurePty: () => void;
  broadcastTheme: () => void;
}): void {
  const { worktreeService, sessionService, stateService, themeService, workspaceService, configService, preferenceService, tmux, git, getPtyClientTty, getActiveSession, setActiveSession, ensurePty, broadcastTheme } = deps;

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
            const repoName = require('node:path').basename(repoRoot);
            const sessionName = sessionService.getSessionName(ws.name, { type: 'directory', repoName });
            const prevClaudeId = findClaudeSessionId(workspaceService, sessionName);
            const session = await sessionService.launchDirectorySession(ws.name, repoRoot, config, prevClaudeId);
            const windows = buildWindowSpecs('directory', config.tmux, prevClaudeId);
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

  ipcMain.handle(Channels.SLEEP_SESSION, async (_event, session: string) => {
    try {
      await tmux.killSession(session);
      // Persisted session is intentionally kept — its claudeSessionId
      // will be reused when the session is recreated.
      return ok(undefined);
    } catch (e) {
      return err((e as Error).message);
    }
  });

  ipcMain.handle(Channels.DESTROY_SESSION, async (_event, session: string) => {
    try {
      // Kill tmux session if it's running
      if (await tmux.hasSession(session)) {
        await tmux.killSession(session);
      }
      // Remove the persisted session entry permanently
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
      const sessionName = sessionService.getSessionName(workspaceName, { type: 'workspace', label });
      const prevClaudeId = findClaudeSessionId(workspaceService, sessionName);
      const session = await sessionService.launchWorkspaceSession(workspaceName, workspaceDir, config, label, prevClaudeId);
      // Persist session definition
      const ws = workspaceService.findBySessionPrefix(session);
      if (ws) {
        const windows = buildWindowSpecs('workspace', config.tmux, prevClaudeId);
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
      let prevClaudeId: string | undefined;
      if (mode === 'directory') {
        const repoName = require('node:path').basename(repoRoot);
        const sessionName = sessionService.getSessionName(workspaceName, { type: 'directory', repoName });
        prevClaudeId = findClaudeSessionId(workspaceService, sessionName);
        session = await sessionService.launchDirectorySession(workspaceName, repoRoot, config, prevClaudeId);
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
        const repoName = require('node:path').basename(repoRoot);
        const sessionName = sessionService.getSessionName(workspaceName, { type: 'worktree', repoName, branch });
        prevClaudeId = findClaudeSessionId(workspaceService, sessionName);
        session = await sessionService.launchWorktreeSession(workspaceName, repoRoot, branch, wtPath, config, prevClaudeId);
        sessionType = 'worktree';
        sessionDir = wtPath;
      }

      // Persist session definition
      const ws = workspaceService.findBySessionPrefix(session);
      if (ws) {
        const windows = buildWindowSpecs(sessionType, config.tmux, prevClaudeId);
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
      const repoName = require('node:path').basename(repoRoot);
      const sessionName = sessionService.getSessionName(workspaceName, { type: 'worktree', repoName, branch });
      const prevClaudeId = findClaudeSessionId(workspaceService, sessionName);
      const session = await sessionService.launchWorktreeSession(workspaceName, repoRoot, branch, worktreePath, config, prevClaudeId);
      // Persist session definition
      const ws = workspaceService.findBySessionPrefix(session);
      if (ws) {
        const windows = buildWindowSpecs('worktree', config.tmux, prevClaudeId);
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
      // Merge: keep existing specs (with commands/claudeSessionIds), add new window as bare name
      const ws = workspaceService.findBySessionPrefix(session);
      if (ws) {
        const existing = workspaceService.getPersistedSessions(ws.id).find((s) => s.tmuxSession === session);
        if (existing) {
          const currentSpecs = normalizeWindows(existing.windows);
          const updatedWindows = await tmux.listWindows(session);
          const updatedNames = new Set(updatedWindows.map((w) => w.name));
          // Keep existing specs for windows that still exist, add new ones as bare names
          const merged = currentSpecs.filter((s) => updatedNames.has(s.name));
          for (const w of updatedWindows) {
            if (!merged.some((s) => s.name === w.name)) {
              merged.push({ name: w.name });
            }
          }
          await workspaceService.persistSession(ws.id, { ...existing, windows: merged });
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
        // Persisted session is intentionally kept for resume.
      } else {
        await tmux.killWindow(session, windowIndex);
        // Merge: preserve existing specs (with commands/claudeSessionIds) for surviving windows
        const ws = workspaceService.findBySessionPrefix(session);
        if (ws) {
          const existing = workspaceService.getPersistedSessions(ws.id).find((s) => s.tmuxSession === session);
          if (existing) {
            const currentSpecs = normalizeWindows(existing.windows);
            const updatedWindows = await tmux.listWindows(session);
            const updatedNames = new Set(updatedWindows.map((w) => w.name));
            const merged = currentSpecs.filter((s) => updatedNames.has(s.name));
            await workspaceService.persistSession(ws.id, { ...existing, windows: merged });
          }
        }
      }
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
}
