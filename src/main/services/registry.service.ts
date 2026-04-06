import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import { readdirSync, statSync, existsSync } from 'node:fs';
import type { FileSystemPort } from '../ports/filesystem.port';

const DEFAULT_REGISTRY_DIR = join(homedir(), '.local', 'share', 'wt');

export class RegistryService {
  private registryDir: string;
  private registryPath: string;

  constructor(private fs: FileSystemPort, registryDir?: string) {
    this.registryDir = registryDir ?? DEFAULT_REGISTRY_DIR;
    this.registryPath = join(this.registryDir, 'repos.json');
  }

  load(): Record<string, string> {
    try {
      const { readFileSync } = require('node:fs');
      return JSON.parse(readFileSync(this.registryPath, 'utf-8'));
    } catch {
      return {};
    }
  }

  async save(name: string, rootPath: string): Promise<void> {
    const registry = this.load();
    if (registry[name] === rootPath) return;
    registry[name] = rootPath;
    await this.fs.mkdir(this.registryDir);
    await this.fs.writeFile(this.registryPath, JSON.stringify(registry, null, 2) + '\n');
  }

  async remove(name: string): Promise<void> {
    const registry = this.load();
    if (!(name in registry)) return;
    delete registry[name];
    await this.fs.mkdir(this.registryDir);
    await this.fs.writeFile(this.registryPath, JSON.stringify(registry, null, 2) + '\n');
  }

  discoverGitRepos(folderPath: string, maxDepth: number): string[] {
    if (existsSync(join(folderPath, '.git'))) {
      return [folderPath];
    }
    return this.walkForGitRepos(folderPath, maxDepth, 0);
  }

  async pinMany(paths: string[]): Promise<void> {
    const registry = this.load();
    let changed = false;
    for (const p of paths) {
      const name = basename(p);
      if (registry[name] === p) continue;
      registry[name] = p;
      changed = true;
    }
    if (!changed) return;
    await this.fs.mkdir(this.registryDir);
    await this.fs.writeFile(this.registryPath, JSON.stringify(registry, null, 2) + '\n');
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
