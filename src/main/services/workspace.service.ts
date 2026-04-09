import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import { readdirSync, statSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { FileSystemPort } from '../ports/filesystem.port';
import type { Workspace, WorkspaceOrdering } from '../domain/types';

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
