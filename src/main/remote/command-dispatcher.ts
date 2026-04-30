import type { StateService } from '../services/state.service';
import type { WorkspaceService } from '../services/workspace.service';
import type { SessionLifecycleService } from '../services/session-lifecycle.service';
import type { GitPort } from '../ports/git.port';
import type { TmuxPort } from '../ports/tmux.port';
import type { Result } from '../domain/types';
import { ok, err } from '../domain/result-helpers';
import { RemoteCommand } from '../../shared/remote-commands';

export type DispatcherDeps = {
  stateService: StateService;
  workspaceService: WorkspaceService;
  sessionLifecycle: SessionLifecycleService;
  git: GitPort;
  tmux: TmuxPort;
  /** Validates directory is within allowed workspace roots. Required —
   * pass `() => true` only in trusted local-test contexts. */
  isAllowedDirectory: (dir: string) => boolean;
};

type DispatchResult = Result<unknown>;

// ── Input validation (defense in depth) ───────────────────────────────────
// Even with argv-based exec in adapters, we reject obviously dangerous values
// at the boundary so they never reach path joins, persisted state, or tmux
// session names. Allow-lists are intentionally narrow.

const BRANCH_RE = /^[A-Za-z0-9._/-]+$/;
const LABEL_RE = /^[\w. -]+$/;
const REPO_PATH_RE = /^[^\0]+$/;

function validateBranch(branch: unknown): branch is string {
  if (typeof branch !== 'string') return false;
  if (branch.length === 0 || branch.length > 200) return false;
  if (!BRANCH_RE.test(branch)) return false;
  if (branch.includes('..')) return false;
  if (branch.startsWith('-') || branch.startsWith('/')) return false;
  return true;
}

function validateLabel(label: unknown): label is string {
  if (typeof label !== 'string') return false;
  if (label.length === 0 || label.length > 64) return false;
  return LABEL_RE.test(label);
}

function validateWorkspaceName(name: unknown): name is string {
  return typeof name === 'string' && name.length > 0 && name.length <= 64
    && !name.includes('/') && !name.includes('\\') && !/[\0\n\r]/.test(name);
}

function validateRepoPath(path: unknown): path is string {
  return typeof path === 'string' && path.length > 0 && REPO_PATH_RE.test(path);
}

/** Sanitise an Error message for a remote client. Logs the full message
 * server-side and returns a brief category string so paths/internals don't
 * leak over the WebSocket. */
function sanitiseError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  // eslint-disable-next-line no-console
  console.error('[remote-dispatcher] error:', msg);
  if (/not.*found|no such|unknown/i.test(msg)) return 'Not found';
  if (/invalid|bad|malformed|forbidden/i.test(msg)) return 'Invalid argument';
  return 'Internal error';
}

/**
 * Translate WebSocket session-command messages into `SessionLifecycleService`
 * calls. Responsibilities (and only these):
 *
 *  - Validate user-controlled inputs (branch, label, workspace, paths).
 *  - Enforce the allowed-directory boundary check.
 *  - Sanitise errors before they cross the wire.
 *  - Map service results to the wire-format Result envelope.
 *
 * The dispatcher does not own session/window business logic — that lives in
 * `SessionLifecycleService`, shared with the local IPC handler.
 */
export class CommandDispatcher {
  constructor(private deps: DispatcherDeps) {}

  async dispatch(command: string, params: Record<string, unknown>): Promise<DispatchResult> {
    try {
      switch (command) {
        case RemoteCommand.GetState:
          return ok(await this.deps.stateService.collectWorkspaces());

        case RemoteCommand.GetBranches: {
          const repoRoot = params.repoRoot as string;
          if (!validateRepoPath(repoRoot)) return err('Invalid argument');
          if (!this.deps.isAllowedDirectory(repoRoot)) {
            return err('Directory not within any workspace root');
          }
          return ok(await this.deps.git.listBranches(repoRoot));
        }

        case RemoteCommand.DiscoverRepos: {
          const dir = params.directory as string;
          if (!validateRepoPath(dir)) return err('Invalid argument');
          if (!this.deps.isAllowedDirectory(dir)) {
            return err('Directory not within any workspace root');
          }
          return ok(this.deps.workspaceService.discoverGitRepos(dir, 3));
        }

        case RemoteCommand.SelectWindow: {
          const session = params.session as string;
          const window = params.window as string;
          if (!this.assertKnownSession(session)) return err('Unknown session');
          return this.deps.sessionLifecycle.selectWindow(session, window);
        }

        case RemoteCommand.NewWindow: {
          const session = params.session as string;
          const name = params.name as string;
          if (!this.assertKnownSession(session)) return err('Unknown session');
          // For tmux backend, the dispatcher fetches the pane cwd before
          // delegating, since the supervisor doesn't expose that primitive
          // and the service deliberately doesn't reach for tmux directly.
          const cwd = this.deps.workspaceService.resolveBackend(session) === 'tmux'
            ? (await this.deps.tmux.displayMessage(`${session}:0`, '#{pane_current_path}')).trim() || '/'
            : undefined;
          return this.deps.sessionLifecycle.newWindow(session, name, cwd);
        }

        case RemoteCommand.KillWindow: {
          const session = params.session as string;
          const windowIndex = params.windowIndex as number;
          if (!this.assertKnownSession(session)) return err('Unknown session');
          const r = await this.deps.sessionLifecycle.killWindow(session, windowIndex);
          if (!r.success) return r;
          return ok(undefined);
        }

        case RemoteCommand.SetWindowOrder: {
          const session = params.session as string;
          const names = params.names as string[];
          if (typeof session !== 'string' || !session) return err('Invalid session');
          if (!Array.isArray(names) || !names.every((n) => typeof n === 'string')) {
            return err('Invalid names payload');
          }
          return this.deps.sessionLifecycle.setWindowOrder(session, names);
        }

        case RemoteCommand.ListWindows: {
          const session = params.session as string;
          if (!this.assertKnownSession(session)) return err('Unknown session');
          return this.deps.sessionLifecycle.listWindows(session);
        }

        case RemoteCommand.SleepSession: {
          const session = params.session as string;
          if (!this.assertKnownSession(session)) return err('Unknown session');
          return this.deps.sessionLifecycle.sleep(session);
        }

        case RemoteCommand.WakeSession: {
          const session = params.session as string;
          const r = await this.deps.sessionLifecycle.wake(session);
          if (!r.success) return r;
          if (r.data === null) return err('No persisted session found');
          // Native sessions return a synthesized window list; tmux returns
          // null and the renderer will follow up with list-windows.
          return ok(r.data.windows ?? undefined);
        }

        case RemoteCommand.DestroySession: {
          const session = params.session as string;
          if (!this.assertKnownSession(session)) return err('Unknown session');
          return this.deps.sessionLifecycle.destroy(session);
        }

        case RemoteCommand.CreateWorkspaceSession: {
          const { workspaceName, workspaceDir, label } = params as {
            workspaceName: string; workspaceDir: string; label?: string;
          };
          if (!validateWorkspaceName(workspaceName)) return err('Invalid argument');
          if (!validateRepoPath(workspaceDir)) return err('Invalid argument');
          if (label !== undefined && !validateLabel(label)) return err('Invalid argument');
          if (!this.deps.isAllowedDirectory(workspaceDir)) {
            return err('Directory not within any workspace root');
          }
          const r = await this.deps.sessionLifecycle.createWorkspaceSession({
            workspaceName, workspaceDir, label,
          });
          return r.success ? ok(r.data.sessionId) : r;
        }

        case RemoteCommand.CreateRepoSession: {
          const { workspaceName, repoRoot, mode, branch, base } = params as {
            workspaceName: string; repoRoot: string; mode: string;
            branch?: string; base?: string;
          };
          if (!validateWorkspaceName(workspaceName)) return err('Invalid argument');
          if (!validateRepoPath(repoRoot)) return err('Invalid argument');
          if (mode !== 'directory' && mode !== 'worktree') return err('Invalid argument');
          if (mode === 'worktree') {
            if (!validateBranch(branch)) return err('Invalid argument');
            if (base !== undefined && !validateBranch(base.replace(/^origin\//, ''))) return err('Invalid argument');
          }
          if (!this.deps.isAllowedDirectory(repoRoot)) {
            return err('Directory not within any workspace root');
          }
          const r = await this.deps.sessionLifecycle.createRepoSession({
            workspaceName, repoRoot, mode, branch, base,
          });
          return r.success ? ok(r.data.sessionId) : r;
        }

        case RemoteCommand.CreateStandaloneSession: {
          const { label, dir } = params as { label: string; dir: string };
          if (!validateLabel(label)) return err('Invalid argument');
          if (!validateRepoPath(dir)) return err('Invalid argument');
          if (!this.deps.isAllowedDirectory(dir)) {
            return err('Directory not within any workspace root');
          }
          const r = await this.deps.sessionLifecycle.createStandaloneSession({ label, dir });
          return r.success ? ok(r.data.sessionId) : r;
        }

        default:
          return err(`Unknown command: ${command}`);
      }
    } catch (e) {
      return err(sanitiseError(e));
    }
  }

  /** A session is "known" if it lives under a registered workspace prefix or
   *  is a standalone session. Used as a coarse pre-check before delegating
   *  window operations to the lifecycle service. */
  private assertKnownSession(session: string): boolean {
    if (this.deps.workspaceService.findBySessionPrefix(session)) return true;
    if (typeof session === 'string' && session.startsWith('_standalone/')) return true;
    return false;
  }
}
