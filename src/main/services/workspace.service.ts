import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import { readdirSync, statSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { FileSystemPort } from '../ports/filesystem.port';
import type { Workspace, WorkspaceOrdering, PinnedRepo, PersistedSession, SessionBackend } from '../domain/types';
import { getBackend } from '../domain/types';
import type { TabConfig } from '../domain/tab-config';

const DEFAULT_STORAGE_DIR = join(homedir(), '.local', 'share', 'gustav');

export class WorkspaceService {
  private storagePath: string;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(
    private fs: FileSystemPort,
    storageDir?: string,
  ) {
    this.storagePath = join(storageDir ?? DEFAULT_STORAGE_DIR, 'workspaces.json');
  }

  /** Serialize all mutating operations to prevent concurrent read-modify-write races on workspaces.json. */
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.writeQueue.then(fn, fn);
    this.writeQueue = result.then(() => {}, () => {});
    return result;
  }

  list(): Workspace[] {
    try {
      const { readFileSync } = require('node:fs');
      const data = JSON.parse(readFileSync(this.storagePath, 'utf-8'));
      return data.workspaces ?? [];
    } catch {
      return [];
    }
  }

  async create(name: string, directory: string): Promise<Workspace> {
    return this.enqueue(async () => {
      const existing = this.list();
      if (existing.some((w) => w.directory === directory)) {
        throw new Error(`A workspace for directory "${directory}" already exists`);
      }
      const workspace: Workspace = { id: randomUUID(), name, directory };
      existing.push(workspace);
      await this.persist(existing);
      return workspace;
    });
  }

  async rename(id: string, newName: string): Promise<void> {
    return this.enqueue(async () => {
      const workspaces = this.list();
      const ws = workspaces.find((w) => w.id === id);
      if (!ws) throw new Error(`Workspace "${id}" not found`);
      ws.name = newName;
      await this.persist(workspaces);
    });
  }

  async remove(id: string): Promise<void> {
    return this.enqueue(async () => {
      const workspaces = this.list().filter((w) => w.id !== id);
      await this.persist(workspaces);
    });
  }

  async updateOrdering(id: string, ordering: WorkspaceOrdering): Promise<void> {
    return this.enqueue(async () => {
      const workspaces = this.list();
      const ws = workspaces.find((w) => w.id === id);
      if (!ws) throw new Error(`Workspace "${id}" not found`);
      ws.ordering = ordering;
      await this.persist(workspaces);
    });
  }

  async reorder(ids: string[]): Promise<void> {
    return this.enqueue(async () => {
      const workspaces = this.list();
      const byId = new Map(workspaces.map((w) => [w.id, w]));
      const reordered = ids.map((id) => byId.get(id)).filter(Boolean) as Workspace[];
      for (const w of workspaces) {
        if (!ids.includes(w.id)) reordered.push(w);
      }
      await this.persist(reordered);
    });
  }

  async pinRepos(id: string, repoPaths: string[]): Promise<void> {
    return this.enqueue(async () => {
      const workspaces = this.list();
      const ws = workspaces.find((w) => w.id === id);
      if (!ws) throw new Error(`Workspace "${id}" not found`);
      const existing = ws.pinnedRepos ?? [];
      const existingPaths = new Set(existing.map((r) => r.path));
      for (const repoPath of repoPaths) {
        if (!existingPaths.has(repoPath)) {
          existing.push({ path: repoPath, repoName: basename(repoPath) });
          existingPaths.add(repoPath);
        }
      }
      ws.pinnedRepos = existing;
      await this.persist(workspaces);
    });
  }

  async unpinRepo(id: string, repoPath: string): Promise<void> {
    return this.enqueue(async () => {
      const workspaces = this.list();
      const ws = workspaces.find((w) => w.id === id);
      if (!ws) throw new Error(`Workspace "${id}" not found`);
      ws.pinnedRepos = (ws.pinnedRepos ?? []).filter((r) => r.path !== repoPath);
      await this.persist(workspaces);
    });
  }

  /** Set or clear the per-workspace default-tabs override. `null` clears the
   * field (resolver falls back to globals); any array — including empty — is
   * preserved as an explicit override. */
  async setDefaultTabs(id: string, tabs: TabConfig[] | null): Promise<void> {
    return this.enqueue(async () => {
      const workspaces = this.list();
      const ws = workspaces.find((w) => w.id === id);
      if (!ws) throw new Error(`Workspace "${id}" not found`);
      if (tabs === null) {
        delete ws.defaultTabs;
      } else {
        ws.defaultTabs = tabs;
      }
      await this.persist(workspaces);
    });
  }

  async persistSession(id: string, session: PersistedSession): Promise<void> {
    return this.enqueue(async () => {
      const workspaces = this.list();
      const ws = workspaces.find((w) => w.id === id);
      if (!ws) throw new Error(`Workspace "${id}" not found`);
      const sessions = ws.sessions ?? [];
      const idx = sessions.findIndex((s) => s.tmuxSession === session.tmuxSession);
      if (idx >= 0) { sessions[idx] = session; } else { sessions.push(session); }
      ws.sessions = sessions;
      await this.persist(workspaces);
    });
  }

  /**
   * Reorder a persisted session's windows array so that names appear in the
   * given order. Names not present in the persisted session are ignored.
   * Persisted windows whose name is not in `names` are appended at the end,
   * preserving their existing relative order. No-op for unknown workspace
   * or unknown session.
   */
  async setSessionWindowOrder(id: string, tmuxSession: string, names: string[]): Promise<void> {
    return this.enqueue(async () => {
      const workspaces = this.list();
      const ws = workspaces.find((w) => w.id === id);
      if (!ws) return;
      const session = (ws.sessions ?? []).find((s) => s.tmuxSession === tmuxSession);
      if (!session) return;

      const byName = new Map(session.windows.map((w) => [w.name, w]));
      const ordered: typeof session.windows = [];
      const seen = new Set<string>();

      for (const name of names) {
        const win = byName.get(name);
        if (!win || seen.has(name)) continue;
        seen.add(name);
        ordered.push(win);
      }
      for (const win of session.windows) {
        if (seen.has(win.name)) continue;
        ordered.push(win);
      }

      session.windows = ordered;
      await this.persist(workspaces);
    });
  }

  async removeSession(id: string, tmuxSession: string): Promise<void> {
    return this.enqueue(async () => {
      const workspaces = this.list();
      const ws = workspaces.find((w) => w.id === id);
      if (!ws) return;
      ws.sessions = (ws.sessions ?? []).filter((s) => s.tmuxSession !== tmuxSession);
      await this.persist(workspaces);
    });
  }

  getPersistedSessions(id: string): PersistedSession[] {
    const ws = this.list().find((w) => w.id === id);
    return ws?.sessions ?? [];
  }

  findBySessionPrefix(tmuxSession: string): Workspace | undefined {
    const workspaces = this.list();
    const firstSlash = tmuxSession.indexOf('/');
    if (firstSlash === -1) return undefined;
    const prefix = tmuxSession.slice(0, firstSlash);
    return workspaces.find((w) => w.name === prefix);
  }

  /**
   * Look up the backend for a session by id. Returns `null` if the session
   * is not found in any workspace's persisted entries — callers should
   * default to `'tmux'` for backward compatibility (legacy sessions
   * predating the strangler flag are tmux-backed).
   */
  findPersistedBackend(sessionId: string): SessionBackend | null {
    const ws = this.findBySessionPrefix(sessionId);
    if (!ws) return null;
    const persisted = this.getPersistedSessions(ws.id).find((s) => s.tmuxSession === sessionId);
    if (!persisted) return null;
    return getBackend(persisted);
  }

  /**
   * Resolve the backend for a session. Returns `'tmux'` when the session is
   * not in any persisted entry — covers legacy sessions that predate the
   * strangler flag and sessions created by a different Gustav process.
   * Centralises the `?? 'tmux'` default that was previously duplicated in
   * every IPC and remote-dispatcher call site.
   */
  resolveBackend(sessionId: string): SessionBackend {
    return this.findPersistedBackend(sessionId) ?? 'tmux';
  }

  /**
   * Look up the previous Claude session ID for a session name, so a recreate
   * after sleep/destroy can pass `claude --resume <id>` and continue the same
   * conversation. Returns `undefined` if no persisted entry exists or no
   * Claude window was tracked.
   */
  findClaudeSessionId(sessionId: string): string | undefined {
    const ws = this.findBySessionPrefix(sessionId);
    if (!ws) return undefined;
    const persisted = this.getPersistedSessions(ws.id).find((s) => s.tmuxSession === sessionId);
    if (!persisted) return undefined;
    const claude = persisted.windows.find((s) => s.name === 'Claude Code');
    return claude?.claudeSessionId;
  }

  findByDirectory(directory: string): Workspace | undefined {
    return this.list().find((w) => w.directory === directory);
  }

  discoverGitRepos(folderPath: string, maxDepth: number): string[] {
    if (existsSync(join(folderPath, '.git'))) {
      return [folderPath];
    }
    return this.walkForGitRepos(folderPath, maxDepth, 0);
  }

  private async persist(workspaces: Workspace[]): Promise<void> {
    const dir = join(this.storagePath, '..');
    await this.fs.mkdir(dir);
    await this.fs.writeFile(
      this.storagePath,
      JSON.stringify({ workspaces }, null, 2) + '\n',
    );
  }

  private walkForGitRepos(dir: string, maxDepth: number, currentDepth: number): string[] {
    if (currentDepth >= maxDepth) return [];

    const results: string[] = [];
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return [];
    }

    for (const entry of entries) {
      if (entry === 'node_modules' || entry === '.git' || entry.startsWith('.')) continue;

      const fullPath = join(dir, entry);
      try {
        if (!statSync(fullPath).isDirectory()) continue;
      } catch {
        continue;
      }

      if (existsSync(join(fullPath, '.git'))) {
        results.push(fullPath);
      } else {
        results.push(...this.walkForGitRepos(fullPath, maxDepth, currentDepth + 1));
      }
    }
    return results;
  }
}
