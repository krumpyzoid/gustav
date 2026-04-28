import type { StateService } from '../services/state.service';
import type { SessionService } from '../services/session.service';
import type { WorkspaceService } from '../services/workspace.service';
import type { RepoConfigService } from '../services/repo-config.service';
import type { PreferenceService } from '../services/preference.service';
import type { GitPort } from '../ports/git.port';
import type { TmuxPort } from '../ports/tmux.port';
import type { Result } from '../domain/types';
import { buildWindowSpecs } from '../ipc/build-window-specs';
import { applyPersistedWindowOrder } from '../ipc/apply-persisted-window-order';

export type DispatcherDeps = {
  stateService: StateService;
  sessionService: SessionService;
  workspaceService: WorkspaceService;
  repoConfigService: RepoConfigService;
  preferenceService: PreferenceService;
  git: GitPort;
  tmux: TmuxPort;
  /** Validates directory is within allowed workspace roots */
  isAllowedDirectory?: (dir: string) => boolean;
};

type DispatchResult = Result<unknown>;

export class CommandDispatcher {
  constructor(private deps: DispatcherDeps) {}

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
          await this.deps.tmux.selectWindow(session, window);
          return ok(undefined);
        }

        case 'new-window': {
          const session = params.session as string;
          const name = params.name as string;
          if (!this.deps.workspaceService.findBySessionPrefix(session) && !session.startsWith('_standalone/')) {
            return err('Unknown session');
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
          const live = await this.deps.tmux.listWindows(session);
          const ws = this.deps.workspaceService.findBySessionPrefix(session);
          const persisted = ws
            ? this.deps.workspaceService.getPersistedSessions(ws.id).find((s) => s.tmuxSession === session)
            : undefined;
          return ok(applyPersistedWindowOrder(live, persisted?.windows ?? []));
        }

        case 'sleep-session': {
          const session = params.session as string;
          // Only allow killing Gustav-managed sessions
          if (!this.deps.workspaceService.findBySessionPrefix(session) && !session.startsWith('_standalone/')) {
            return err('Unknown session');
          }
          if (await this.deps.tmux.hasSession(session)) {
            await this.deps.tmux.killSession(session);
          }
          return ok(undefined);
        }

        case 'wake-session': {
          const session = params.session as string;
          const ws = this.deps.workspaceService.findBySessionPrefix(session);
          if (ws) {
            const persisted = this.deps.workspaceService
              .getPersistedSessions(ws.id)
              .find((s) => s.tmuxSession === session);
            if (persisted) {
              await this.deps.sessionService.restoreSession(persisted);
              return ok(undefined);
            }
          }
          return err('No persisted session found');
        }

        case 'destroy-session': {
          const session = params.session as string;
          if (!this.deps.workspaceService.findBySessionPrefix(session) && !session.startsWith('_standalone/')) {
            return err('Unknown session');
          }
          if (await this.deps.tmux.hasSession(session)) {
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
          const session = await this.deps.sessionService.launchSession(sessionName, workspaceDir, windows);
          return ok(session);
        }

        case 'create-repo-session': {
          const { workspaceName, repoRoot, mode, branch } = params as {
            workspaceName: string; repoRoot: string; mode: string;
            branch?: string; base?: string;
          };
          if (this.deps.isAllowedDirectory && !this.deps.isAllowedDirectory(repoRoot)) {
            return err('Directory not within any workspace root');
          }
          if (mode === 'directory') {
            const repoName = repoRoot.split('/').pop() ?? repoRoot;
            const sessionName = this.deps.sessionService.getSessionName(workspaceName, { type: 'directory', repoName });
            const ws = this.deps.workspaceService.list().find((w) => w.name === workspaceName) ?? null;
            const windows = buildWindowSpecs({
              type: 'directory',
              workspace: ws,
              preferences: this.deps.preferenceService.load(),
              repoConfig: this.deps.repoConfigService.get(repoRoot),
            });
            const session = await this.deps.sessionService.launchSession(sessionName, repoRoot, windows);
            return ok(session);
          }
          if (!branch) return err('Branch required for worktree session');
          // Worktree mode would need worktree creation first — delegate to caller
          return ok(undefined);
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
          const session = await this.deps.sessionService.launchSession(sessionName, dir, windows);
          return ok(session);
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
