import { basename, join } from 'node:path';
import type { WorkspaceService } from './workspace.service';
import type { SessionService } from './session.service';
import type { SessionLauncherService } from './session-launcher.service';
import type { WorktreeService } from './worktree.service';
import type { RepoConfigService } from './repo-config.service';
import type { PreferenceService } from './preference.service';
import type { SessionSupervisorPort } from '../supervisor/supervisor.port';
import type { GitPort } from '../ports/git.port';
import type { TmuxPort } from '../ports/tmux.port';
import type { Result, SessionBackend, SessionType, WindowInfo, WindowSpec, PersistedSession } from '../domain/types';
import { ok, err } from '../domain/result-helpers';
import { supervisorWindowsAsInfo } from '../supervisor/supervisor-utils';
import { applyPersistedWindowOrder } from '../domain/apply-persisted-window-order';
import { buildWindowSpecs } from '../domain/build-window-specs';

/**
 * Single home for session lifecycle and window operations.
 *
 * Both the local IPC handlers (`src/main/ipc/handlers.ts`) and the remote
 * command dispatcher (`src/main/remote/command-dispatcher.ts`) delegate to
 * this service so they cannot drift on backend dispatch, persisted-state
 * transitions, or the `findClaudeSessionId` resume contract.
 *
 * The service intentionally does **not** handle:
 * - input validation — callers (the security-boundary adapters) own that.
 * - active-session bookkeeping (`setActiveSession`, `switchAfterPty`) — those
 *   are local-only concerns; the service returns the launched session info
 *   and the local caller does the post-effect.
 * - PTY client management (`ensurePty`, `getPtyClientTty`) — local-only.
 * - tmux client switching — local-only post-effect after wake/create.
 * - error sanitisation — callers decide what to expose.
 *
 * The service trusts its inputs. Adapters validate before calling.
 */

export type SessionLifecycleDeps = {
  workspaceService: WorkspaceService;
  sessionService: SessionService;
  sessionLauncher: SessionLauncherService;
  worktreeService: WorktreeService;
  repoConfigService: RepoConfigService;
  preferenceService: PreferenceService;
  supervisor: SessionSupervisorPort;
  git: GitPort;
  tmux: TmuxPort;
};

/** Outcome of a successful create/launch — callers persist no further state
 *  themselves; the service has already updated `workspaces.json`. */
export type LaunchedSession = {
  sessionId: string;
  backend: SessionBackend;
};

export type WakeOutcome = {
  backend: SessionBackend;
  /** For native sessions, synthesized from `supervisor.listWindows`. For tmux
   *  sessions the live window list is not yet known — the local caller will
   *  fetch it after `switchAfterPty` runs. */
  windows: WindowInfo[] | null;
  /** The persisted entry that was woken — exposed so callers can drive any
   *  post-step (e.g. tmux client switch) without re-querying. */
  persisted: PersistedSession;
};

export type KillWindowOutcome = {
  /** True when the killed window was the only one — the whole session was
   *  killed instead. The local caller doesn't need to snapshot in this case. */
  wasLastWindow: boolean;
};

export class SessionLifecycleService {
  constructor(private deps: SessionLifecycleDeps) {}

  // ── Lifecycle ───────────────────────────────────────────────────

  /** Wake a persisted session. Returns null if no persisted entry matches. */
  async wake(sessionId: string): Promise<Result<WakeOutcome | null>> {
    try {
      const ws = this.deps.workspaceService.findBySessionPrefix(sessionId);
      if (!ws) return ok(null);
      const persisted = this.deps.workspaceService
        .getPersistedSessions(ws.id)
        .find((s) => s.tmuxSession === sessionId);
      if (!persisted) return ok(null);

      const backend = this.deps.workspaceService.resolveBackend(sessionId);
      if (backend === 'native') {
        if (this.deps.supervisor.hasSession(sessionId)) {
          await this.deps.supervisor.wakeSession(sessionId);
        } else {
          await this.deps.supervisor.createSession({
            sessionId,
            cwd: persisted.directory,
            windows: persisted.windows,
          });
        }
        return ok({
          backend,
          windows: supervisorWindowsAsInfo(this.deps.supervisor, sessionId),
          persisted,
        });
      }
      // Tmux: restore from snapshot. Caller fetches live windows afterward
      // because tmux doesn't expose them until the session is fully attached.
      await this.deps.sessionService.restoreSession(persisted);
      return ok({ backend, windows: null, persisted });
    } catch (e) {
      return err((e as Error).message);
    }
  }

  /** Sleep a session. For tmux callers should snapshot before invoking; the
   *  service intentionally doesn't snapshot because that requires PTY
   *  introspection only available locally. */
  async sleep(sessionId: string): Promise<Result<void>> {
    try {
      const backend = this.deps.workspaceService.resolveBackend(sessionId);
      if (backend === 'native') {
        if (this.deps.supervisor.hasSession(sessionId)) {
          await this.deps.supervisor.sleepSession(sessionId);
        }
        return ok(undefined);
      }
      if (await this.deps.tmux.hasSession(sessionId)) {
        await this.deps.tmux.killSession(sessionId);
      }
      return ok(undefined);
    } catch (e) {
      return err((e as Error).message);
    }
  }

  /** Destroy: kill (if alive) and remove the persisted entry. */
  async destroy(sessionId: string): Promise<Result<void>> {
    try {
      const backend = this.deps.workspaceService.resolveBackend(sessionId);
      if (backend === 'native') {
        if (this.deps.supervisor.hasSession(sessionId)) {
          await this.deps.supervisor.killSession(sessionId);
        }
      } else if (await this.deps.tmux.hasSession(sessionId)) {
        await this.deps.tmux.killSession(sessionId);
      }
      const ws = this.deps.workspaceService.findBySessionPrefix(sessionId);
      if (ws) {
        await this.deps.workspaceService.removeSession(ws.id, sessionId);
      }
      return ok(undefined);
    } catch (e) {
      return err((e as Error).message);
    }
  }

  // ── Window ops ──────────────────────────────────────────────────

  async selectWindow(sessionId: string, windowName: string): Promise<Result<void>> {
    try {
      if (this.deps.workspaceService.resolveBackend(sessionId) === 'native') {
        const w = this.deps.supervisor.listWindows(sessionId).find((mw) => mw.name === windowName);
        if (!w) return err(`Window "${windowName}" not found in session "${sessionId}"`);
        await this.deps.supervisor.selectWindow(sessionId, w.id);
        return ok(undefined);
      }
      await this.deps.tmux.selectWindow(sessionId, windowName);
      return ok(undefined);
    } catch (e) {
      return err((e as Error).message);
    }
  }

  /** Add a window. For tmux callers handle `displayMessage` (pane_current_path)
   *  themselves and pass `cwd`; the service uses the persisted directory for
   *  native because the supervisor doesn't expose pane cwd. */
  async newWindow(sessionId: string, name: string, tmuxCwd?: string): Promise<Result<void>> {
    try {
      if (this.deps.workspaceService.resolveBackend(sessionId) === 'native') {
        const ws = this.deps.workspaceService.findBySessionPrefix(sessionId);
        const persisted = ws
          ? this.deps.workspaceService.getPersistedSessions(ws.id).find((s) => s.tmuxSession === sessionId)
          : undefined;
        const cwd = persisted?.directory ?? process.env.HOME ?? '/';
        const spec: WindowSpec = { name, kind: 'command', command: '', directory: cwd };
        const newId = await this.deps.supervisor.addWindow(sessionId, spec);
        await this.deps.supervisor.selectWindow(sessionId, newId);
        if (ws && persisted) {
          await this.deps.workspaceService.persistSession(ws.id, {
            ...persisted,
            windows: [...persisted.windows, spec],
          });
        }
        return ok(undefined);
      }
      const cwd = tmuxCwd ?? process.env.HOME ?? '/';
      await this.deps.tmux.newWindow(sessionId, name, cwd);
      await this.deps.tmux.selectWindow(sessionId, name);
      return ok(undefined);
    } catch (e) {
      return err((e as Error).message);
    }
  }

  async killWindow(sessionId: string, windowIndex: number): Promise<Result<KillWindowOutcome>> {
    try {
      if (this.deps.workspaceService.resolveBackend(sessionId) === 'native') {
        const windows = this.deps.supervisor.listWindows(sessionId);
        const target = windows[windowIndex];
        if (!target) return err(`Window index ${windowIndex} out of range for session "${sessionId}"`);
        if (windows.length <= 1) {
          await this.deps.supervisor.killSession(sessionId);
          return ok({ wasLastWindow: true });
        }
        await this.deps.supervisor.killWindow(sessionId, target.id);
        const ws = this.deps.workspaceService.findBySessionPrefix(sessionId);
        const persisted = ws
          ? this.deps.workspaceService.getPersistedSessions(ws.id).find((s) => s.tmuxSession === sessionId)
          : undefined;
        if (ws && persisted) {
          await this.deps.workspaceService.persistSession(ws.id, {
            ...persisted,
            windows: persisted.windows.filter((w) => w.name !== target.name),
          });
        }
        return ok({ wasLastWindow: false });
      }
      const live = await this.deps.tmux.listWindows(sessionId);
      if (live.length <= 1) {
        await this.deps.tmux.killSession(sessionId);
        return ok({ wasLastWindow: true });
      }
      await this.deps.tmux.killWindow(sessionId, windowIndex);
      return ok({ wasLastWindow: false });
    } catch (e) {
      return err((e as Error).message);
    }
  }

  async listWindows(sessionId: string): Promise<Result<WindowInfo[]>> {
    try {
      if (this.deps.workspaceService.resolveBackend(sessionId) === 'native') {
        return ok(supervisorWindowsAsInfo(this.deps.supervisor, sessionId));
      }
      const live = await this.deps.tmux.listWindows(sessionId);
      const ws = this.deps.workspaceService.findBySessionPrefix(sessionId);
      const persisted = ws
        ? this.deps.workspaceService.getPersistedSessions(ws.id).find((s) => s.tmuxSession === sessionId)
        : undefined;
      return ok(applyPersistedWindowOrder(live, persisted?.windows ?? []));
    } catch (e) {
      return err((e as Error).message);
    }
  }

  async setWindowOrder(sessionId: string, names: string[]): Promise<Result<void>> {
    try {
      const ws = this.deps.workspaceService.findBySessionPrefix(sessionId);
      if (!ws) return err('Workspace not found for session');
      await this.deps.workspaceService.setSessionWindowOrder(ws.id, sessionId, names);
      return ok(undefined);
    } catch (e) {
      return err((e as Error).message);
    }
  }

  // ── Creation ────────────────────────────────────────────────────

  /** Look up the previous Claude session id for the given session name so
   *  recreate flows can pass `claude --resume`. */
  private prevClaudeId(sessionName: string): string | undefined {
    return this.deps.workspaceService.findClaudeSessionId(sessionName);
  }

  /** Reject if the target session name already lives in tmux or the supervisor.
   *  Returns the failed Result on conflict, `null` when the name is free.
   *  Callers narrow using `if (dup) return dup;`. */
  private async assertNotExisting(sessionName: string, friendlyName: string): Promise<Result<never> | null> {
    if (await this.deps.tmux.hasSession(sessionName) || this.deps.supervisor.hasSession(sessionName)) {
      return err(`Session "${friendlyName}" already exists`);
    }
    return null;
  }

  async createWorkspaceSession(opts: {
    workspaceName: string;
    workspaceDir: string;
    label?: string;
  }): Promise<Result<LaunchedSession>> {
    try {
      const { workspaceName, workspaceDir, label } = opts;
      const sessionName = this.deps.sessionService.getSessionName(workspaceName, { type: 'workspace', label });
      const friendly = label ?? '_ws';
      const dup = await this.assertNotExisting(sessionName, `${friendly}" in workspace "${workspaceName}`);
      if (dup) return dup;
      const ws = this.deps.workspaceService.list().find((w) => w.name === workspaceName) ?? null;
      const windows = buildWindowSpecs({
        type: 'workspace',
        workspace: ws,
        preferences: this.deps.preferenceService.load(),
        repoConfig: null,
        claudeSessionId: this.prevClaudeId(sessionName),
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
      return ok(launched);
    } catch (e) {
      return err((e as Error).message);
    }
  }

  async createRepoSession(opts: {
    workspaceName: string;
    repoRoot: string;
    mode: 'directory' | 'worktree';
    branch?: string;
    base?: string;
  }): Promise<Result<LaunchedSession>> {
    try {
      const { workspaceName, repoRoot, mode, branch, base } = opts;
      const repoName = basename(repoRoot);
      if (!repoName) return err('Invalid repoRoot');
      const ws = this.deps.workspaceService.list().find((w) => w.name === workspaceName) ?? null;

      let sessionType: SessionType;
      let sessionDir: string;
      let sessionName: string;
      let extraPersisted: { branch?: string; repoRoot?: string } = {};

      if (mode === 'directory') {
        sessionType = 'directory';
        sessionDir = repoRoot;
        sessionName = this.deps.sessionService.getSessionName(workspaceName, { type: 'directory', repoName });
        const dup = await this.assertNotExisting(sessionName, `${repoName}" in workspace "${workspaceName}`);
        if (dup) return dup;
      } else {
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
      }

      const windows = buildWindowSpecs({
        type: sessionType,
        workspace: ws,
        preferences: this.deps.preferenceService.load(),
        repoConfig: this.deps.repoConfigService.get(repoRoot),
        claudeSessionId: this.prevClaudeId(sessionName),
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
      return ok(launched);
    } catch (e) {
      return err((e as Error).message);
    }
  }

  async createStandaloneSession(opts: {
    label: string;
    dir: string;
  }): Promise<Result<LaunchedSession>> {
    try {
      const { label, dir } = opts;
      const sessionName = this.deps.sessionService.getSessionName(null, { type: 'workspace', label });
      const dup = await this.assertNotExisting(sessionName, `Standalone session "${label}`);
      if (dup) return dup;
      const windows = buildWindowSpecs({
        type: 'workspace',
        workspace: null,
        preferences: this.deps.preferenceService.load(),
        repoConfig: null,
        claudeSessionId: this.prevClaudeId(sessionName),
      });
      const launched = await this.deps.sessionLauncher.launch(sessionName, dir, windows);
      // Standalone sessions aren't bound to a workspace; persistence is a
      // no-op until the standalone-workspace concept lands.
      return ok(launched);
    } catch (e) {
      return err((e as Error).message);
    }
  }
}
