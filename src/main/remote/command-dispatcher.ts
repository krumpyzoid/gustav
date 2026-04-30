import type { StateService } from '../services/state.service';
import type { SessionService } from '../services/session.service';
import type { WorkspaceService } from '../services/workspace.service';
import type { WorktreeService } from '../services/worktree.service';
import type { RepoConfigService } from '../services/repo-config.service';
import type { PreferenceService } from '../services/preference.service';
import type { SessionLauncherService } from '../services/session-launcher.service';
import type { SessionSupervisorPort } from '../supervisor/supervisor.port';
import type { GitPort } from '../ports/git.port';
import type { TmuxPort } from '../ports/tmux.port';
import type { Result, SessionBackend, WindowInfo, WindowSpec, SessionType } from '../domain/types';
import { buildWindowSpecs } from '../ipc/build-window-specs';
import { applyPersistedWindowOrder } from '../ipc/apply-persisted-window-order';
import { basename, join } from 'node:path';

export type DispatcherDeps = {
  stateService: StateService;
  sessionService: SessionService;
  workspaceService: WorkspaceService;
  worktreeService: WorktreeService;
  repoConfigService: RepoConfigService;
  preferenceService: PreferenceService;
  sessionLauncher: SessionLauncherService;
  supervisor: SessionSupervisorPort;
  git: GitPort;
  tmux: TmuxPort;
  /** Validates directory is within allowed workspace roots */
  isAllowedDirectory?: (dir: string) => boolean;
};

type DispatchResult = Result<unknown>;

export class CommandDispatcher {
  constructor(private deps: DispatcherDeps) {}

  /** Look up the backend for a session; defaults to `'tmux'` for legacy
   * entries with no recorded backend. Mirrors the local IPC helper. */
  private backendOf(sessionId: string): SessionBackend {
    return this.deps.workspaceService.findPersistedBackend(sessionId) ?? 'tmux';
  }

  /** Build a `WindowInfo[]` from supervisor's window list. The supervisor
   * uses string ids; we synthesize numeric indices to match the renderer. */
  private supervisorWindowsAsInfo(sessionId: string): WindowInfo[] {
    return this.deps.supervisor.listWindows(sessionId).map((w, index) => ({
      index,
      name: w.name,
      active: false,
    }));
  }

  async dispatch(command: string, params: Record<string, unknown>): Promise<DispatchResult> {
    try {
      switch (command) {
        case 'get-state':
          return ok(await this.deps.stateService.collectWorkspaces());

        case 'get-branches': {
          const repoRoot = params.repoRoot as string;
          if (this.deps.isAllowedDirectory && !this.deps.isAllowedDirectory(repoRoot)) {
            return err('Directory not within any workspace root');
          }
          return ok(await this.deps.git.listBranches(repoRoot));
        }

        case 'discover-repos': {
          const dir = params.directory as string;
          if (this.deps.isAllowedDirectory && !this.deps.isAllowedDirectory(dir)) {
            return err('Directory not within any workspace root');
          }
          return ok(this.deps.workspaceService.discoverGitRepos(dir, 3));
        }

        case 'select-window': {
          const session = params.session as string;
          const window = params.window as string;
          if (!this.deps.workspaceService.findBySessionPrefix(session) && !session.startsWith('_standalone/')) {
            return err('Unknown session');
          }
          if (this.backendOf(session) === 'native') {
            const w = this.deps.supervisor.listWindows(session).find((mw) => mw.name === window);
            if (!w) return err(`Window "${window}" not found in session "${session}"`);
            await this.deps.supervisor.selectWindow(session, w.id);
            return ok(undefined);
          }
          await this.deps.tmux.selectWindow(session, window);
          return ok(undefined);
        }

        case 'new-window': {
          const session = params.session as string;
          const name = params.name as string;
          if (!this.deps.workspaceService.findBySessionPrefix(session) && !session.startsWith('_standalone/')) {
            return err('Unknown session');
          }
          if (this.backendOf(session) === 'native') {
            const ws = this.deps.workspaceService.findBySessionPrefix(session);
            const persisted = ws
              ? this.deps.workspaceService.getPersistedSessions(ws.id).find((s) => s.tmuxSession === session)
              : undefined;
            const cwd = persisted?.directory ?? process.env.HOME ?? '/';
            const spec: WindowSpec = { name, kind: 'command', command: '', directory: cwd };
            const newId = await this.deps.supervisor.addWindow(session, spec);
            await this.deps.supervisor.selectWindow(session, newId);
            if (ws && persisted) {
              await this.deps.workspaceService.persistSession(ws.id, {
                ...persisted,
                windows: [...persisted.windows, spec],
              });
            }
            return ok(undefined);
          }
          const cwd = (await this.deps.tmux.displayMessage(`${session}:0`, '#{pane_current_path}')).trim() || '/';
          await this.deps.tmux.newWindow(session, name, cwd);
          await this.deps.tmux.selectWindow(session, name);
          return ok(undefined);
        }

        case 'kill-window': {
          const session = params.session as string;
          const windowIndex = params.windowIndex as number;
          if (!this.deps.workspaceService.findBySessionPrefix(session) && !session.startsWith('_standalone/')) {
            return err('Unknown session');
          }
          if (this.backendOf(session) === 'native') {
            const windows = this.deps.supervisor.listWindows(session);
            const target = windows[windowIndex];
            if (!target) return err(`Window index ${windowIndex} out of range for session "${session}"`);
            if (windows.length <= 1) {
              await this.deps.supervisor.killSession(session);
            } else {
              await this.deps.supervisor.killWindow(session, target.id);
              const ws = this.deps.workspaceService.findBySessionPrefix(session);
              const persisted = ws
                ? this.deps.workspaceService.getPersistedSessions(ws.id).find((s) => s.tmuxSession === session)
                : undefined;
              if (ws && persisted) {
                await this.deps.workspaceService.persistSession(ws.id, {
                  ...persisted,
                  windows: persisted.windows.filter((w) => w.name !== target.name),
                });
              }
            }
            return ok(undefined);
          }
          const windows = await this.deps.tmux.listWindows(session);
          if (windows.length <= 1) {
            await this.deps.tmux.killSession(session);
          } else {
            await this.deps.tmux.killWindow(session, windowIndex);
          }
          return ok(undefined);
        }

        case 'set-window-order': {
          const session = params.session as string;
          const names = params.names as string[];
          if (typeof session !== 'string' || !session) return err('Invalid session');
          if (!Array.isArray(names) || !names.every((n) => typeof n === 'string')) {
            return err('Invalid names payload');
          }
          const ws = this.deps.workspaceService.findBySessionPrefix(session);
          if (!ws) return err('Workspace not found for session');
          await this.deps.workspaceService.setSessionWindowOrder(ws.id, session, names);
          return ok(undefined);
        }

        case 'list-windows': {
          const session = params.session as string;
          if (!this.deps.workspaceService.findBySessionPrefix(session) && !session.startsWith('_standalone/')) {
            return err('Unknown session');
          }
          if (this.backendOf(session) === 'native') {
            return ok(this.supervisorWindowsAsInfo(session));
          }
          const live = await this.deps.tmux.listWindows(session);
          const ws = this.deps.workspaceService.findBySessionPrefix(session);
          const persisted = ws
            ? this.deps.workspaceService.getPersistedSessions(ws.id).find((s) => s.tmuxSession === session)
            : undefined;
          return ok(applyPersistedWindowOrder(live, persisted?.windows ?? []));
        }

        case 'sleep-session': {
          const session = params.session as string;
          if (!this.deps.workspaceService.findBySessionPrefix(session) && !session.startsWith('_standalone/')) {
            return err('Unknown session');
          }
          if (this.backendOf(session) === 'native') {
            if (this.deps.supervisor.hasSession(session)) {
              await this.deps.supervisor.sleepSession(session);
            }
            return ok(undefined);
          }
          if (await this.deps.tmux.hasSession(session)) {
            await this.deps.tmux.killSession(session);
          }
          return ok(undefined);
        }

        case 'wake-session': {
          const session = params.session as string;
          const ws = this.deps.workspaceService.findBySessionPrefix(session);
          if (!ws) return err('No persisted session found');
          const persisted = this.deps.workspaceService
            .getPersistedSessions(ws.id)
            .find((s) => s.tmuxSession === session);
          if (!persisted) return err('No persisted session found');

          if (this.backendOf(session) === 'native') {
            if (this.deps.supervisor.hasSession(session)) {
              await this.deps.supervisor.wakeSession(session);
            } else {
              await this.deps.supervisor.createSession({
                sessionId: session,
                cwd: persisted.directory,
                windows: persisted.windows,
              });
            }
            return ok(this.supervisorWindowsAsInfo(session));
          }
          await this.deps.sessionService.restoreSession(persisted);
          return ok(undefined);
        }

        case 'destroy-session': {
          const session = params.session as string;
          if (!this.deps.workspaceService.findBySessionPrefix(session) && !session.startsWith('_standalone/')) {
            return err('Unknown session');
          }
          if (this.backendOf(session) === 'native') {
            if (this.deps.supervisor.hasSession(session)) {
              await this.deps.supervisor.killSession(session);
            }
          } else if (await this.deps.tmux.hasSession(session)) {
            await this.deps.tmux.killSession(session);
          }
          const ws = this.deps.workspaceService.findBySessionPrefix(session);
          if (ws) {
            await this.deps.workspaceService.removeSession(ws.id, session);
          }
          return ok(undefined);
        }

        case 'create-workspace-session': {
          const { workspaceName, workspaceDir, label } = params as {
            workspaceName: string; workspaceDir: string; label?: string;
          };
          if (this.deps.isAllowedDirectory && !this.deps.isAllowedDirectory(workspaceDir)) {
            return err('Directory not within any workspace root');
          }
          const sessionName = this.deps.sessionService.getSessionName(workspaceName, { type: 'workspace', label });
          const ws = this.deps.workspaceService.list().find((w) => w.name === workspaceName) ?? null;
          const windows = buildWindowSpecs({
            type: 'workspace',
            workspace: ws,
            preferences: this.deps.preferenceService.load(),
            repoConfig: null,
          });
          const launched = await this.deps.sessionLauncher.launch(sessionName, workspaceDir, windows);
          if (ws) {
            await this.deps.workspaceService.persistSession(ws.id, {
              tmuxSession: launched.sessionId,
              type: 'workspace',
              directory: workspaceDir,
              windows,
              backend: launched.backend,
            });
          }
          return ok(launched.sessionId);
        }

        case 'create-repo-session': {
          const { workspaceName, repoRoot, mode, branch, base } = params as {
            workspaceName: string; repoRoot: string; mode: string;
            branch?: string; base?: string;
          };
          if (this.deps.isAllowedDirectory && !this.deps.isAllowedDirectory(repoRoot)) {
            return err('Directory not within any workspace root');
          }
          const repoName = basename(repoRoot);
          const ws = this.deps.workspaceService.list().find((w) => w.name === workspaceName) ?? null;

          let sessionType: SessionType;
          let sessionDir: string;
          let sessionName: string;
          let extraPersisted: { branch?: string; repoRoot?: string } = {};

          if (mode === 'directory') {
            sessionType = 'directory';
            sessionDir = repoRoot;
            sessionName = this.deps.sessionService.getSessionName(workspaceName, { type: 'directory', repoName });
          } else if (mode === 'worktree') {
            if (!branch) return err('Branch name required for worktree session');
            await this.deps.worktreeService.create({
              repo: repoName,
              repoRoot,
              branch,
              base: base ?? this.deps.repoConfigService.get(repoRoot)?.baseBranch ?? 'origin/main',
            });
            sessionType = 'worktree';
            sessionDir = join(this.deps.git.getWorktreeDir(repoRoot), branch);
            sessionName = this.deps.sessionService.getSessionName(workspaceName, { type: 'worktree', repoName, branch });
            extraPersisted = { branch, repoRoot };
          } else {
            return err(`Unknown mode "${mode}"`);
          }

          const windows = buildWindowSpecs({
            type: sessionType,
            workspace: ws,
            preferences: this.deps.preferenceService.load(),
            repoConfig: this.deps.repoConfigService.get(repoRoot),
          });
          const launched = await this.deps.sessionLauncher.launch(sessionName, sessionDir, windows);
          if (ws) {
            await this.deps.workspaceService.persistSession(ws.id, {
              tmuxSession: launched.sessionId,
              type: sessionType,
              directory: sessionDir,
              windows,
              backend: launched.backend,
              ...extraPersisted,
            });
          }
          return ok(launched.sessionId);
        }

        case 'create-standalone-session': {
          const { label, dir } = params as { label: string; dir: string };
          if (this.deps.isAllowedDirectory && !this.deps.isAllowedDirectory(dir)) {
            return err('Directory not within any workspace root');
          }
          const sessionName = this.deps.sessionService.getSessionName(null, { type: 'workspace', label });
          const windows = buildWindowSpecs({
            type: 'workspace',
            workspace: null,
            preferences: this.deps.preferenceService.load(),
            repoConfig: null,
          });
          const launched = await this.deps.sessionLauncher.launch(sessionName, dir, windows);
          return ok(launched.sessionId);
        }

        default:
          return err(`Unknown command: ${command}`);
      }
    } catch (e) {
      return err((e as Error).message);
    }
  }
}

function ok<T>(data: T): Result<T> {
  return { success: true, data };
}

function err(message: string): Result<never> {
  return { success: false, error: message };
}
