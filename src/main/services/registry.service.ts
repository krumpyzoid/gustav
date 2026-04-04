import { join } from 'node:path';
import { homedir } from 'node:os';
import type { FileSystemPort } from '../ports/filesystem.port';

const REGISTRY_DIR = join(homedir(), '.local', 'share', 'wt');
const REGISTRY_PATH = join(REGISTRY_DIR, 'repos.json');

export class RegistryService {
  constructor(private fs: FileSystemPort) {}

  load(): Record<string, string> {
    try {
      // Sync read for simplicity — registry is small
      const { readFileSync } = require('node:fs');
      return JSON.parse(readFileSync(REGISTRY_PATH, 'utf-8'));
    } catch {
      return {};
    }
  }

  async save(name: string, rootPath: string): Promise<void> {
    const registry = this.load();
    if (registry[name] === rootPath) return;
    registry[name] = rootPath;
    await this.fs.mkdir(REGISTRY_DIR);
    await this.fs.writeFile(REGISTRY_PATH, JSON.stringify(registry, null, 2) + '\n');
  }

  async remove(name: string): Promise<void> {
    const registry = this.load();
    if (!(name in registry)) return;
    delete registry[name];
    await this.fs.mkdir(REGISTRY_DIR);
    await this.fs.writeFile(REGISTRY_PATH, JSON.stringify(registry, null, 2) + '\n');
  }
}
