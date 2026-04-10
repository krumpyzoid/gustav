import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import { readdirSync, statSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { FileSystemPort } from '../ports/filesystem.port';
import type { Workspace, WorkspaceOrdering, PinnedRepo, PersistedSession } from '../domain/types';

const DEFAULT_STORAGE_DIR = join(homedir(), '.local', 'share', 'gustav');

export class WorkspaceService {
  private storagePath: string;

  constructor(
    private fs: FileSystemPort,
    storageDir?: string,
  ) {
    this.storagePath = join(storageDir ?? DEFAULT_STORAGE_DIR, 'workspaces.json');
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
    const existing = this.list();
    if (existing.some((w) => w.directory === directory)) {
      throw new Error(`A workspace for directory "${directory}" already exists`);
    }

    const workspace: Workspace = {
      id: randomUUID(),
      name,
      directory,
    };

    existing.push(workspace);
    await this.persist(existing);
    return workspace;
  }

  async rename(id: string, newName: string): Promise<void> {
    const workspaces = this.list();
    const ws = workspaces.find((w) => w.id === id);
    if (!ws) throw new Error(`Workspace "${id}" not found`);
    ws.name = newName;
    await this.persist(workspaces);
  }

  async remove(id: string): Promise<void> {
    const workspaces = this.list().filter((w) => w.id !== id);
    await this.persist(workspaces);
  }

  async updateOrdering(id: string, ordering: WorkspaceOrdering): Promise<void> {
    const workspaces = this.list();
    const ws = workspaces.find((w) => w.id === id);
    if (!ws) throw new Error(`Workspace "${id}" not found`);
    ws.ordering = ordering;
    await this.persist(workspaces);
  }

  async reorder(ids: string[]): Promise<void> {
    const workspaces = this.list();
    const byId = new Map(workspaces.map((w) => [w.id, w]));
    const reordered = ids.map((id) => byId.get(id)).filter(Boolean) as Workspace[];
    // Append any workspaces not in the ids list (safety net)
    for (const w of workspaces) {
      if (!ids.includes(w.id)) reordered.push(w);
    }
    await this.persist(reordered);
  }

  async pinRepos(id: string, repoPaths: string[]): Promise<void> {
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
  }

  async unpinRepo(id: string, repoPath: string): Promise<void> {
    const workspaces = this.list();
    const ws = workspaces.find((w) => w.id === id);
    if (!ws) throw new Error(`Workspace "${id}" not found`);

    ws.pinnedRepos = (ws.pinnedRepos ?? []).filter((r) => r.path !== repoPath);
    await this.persist(workspaces);
  }

  async persistSession(id: string, session: PersistedSession): Promise<void> {
    const workspaces = this.list();
    const ws = workspaces.find((w) => w.id === id);
    if (!ws) throw new Error(`Workspace "${id}" not found`);

    const sessions = ws.sessions ?? [];
    const idx = sessions.findIndex((s) => s.tmuxSession === session.tmuxSession);
    if (idx >= 0) {
      sessions[idx] = session;
    } else {
      sessions.push(session);
    }

    ws.sessions = sessions;
    await this.persist(workspaces);
  }

  async removeSession(id: string, tmuxSession: string): Promise<void> {
    const workspaces = this.list();
    const ws = workspaces.find((w) => w.id === id);
    if (!ws) return;

    ws.sessions = (ws.sessions ?? []).filter((s) => s.tmuxSession !== tmuxSession);
    await this.persist(workspaces);
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
