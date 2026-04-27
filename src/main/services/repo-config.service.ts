import { join } from 'node:path';
import { homedir } from 'node:os';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import type { RepoConfig } from '../domain/repo-config';

const DEFAULT_STORAGE_DIR = join(homedir(), '.local', 'share', 'gustav');

interface OverridesFile {
  overrides: Record<string, RepoConfig>;
}

export class RepoConfigService {
  private filePath: string;
  private cache: OverridesFile | null = null;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(storageDir?: string) {
    this.filePath = join(storageDir ?? DEFAULT_STORAGE_DIR, 'repo-overrides.json');
  }

  get(repoRoot: string): RepoConfig | null {
    return this.load().overrides[repoRoot] ?? null;
  }

  list(): Record<string, RepoConfig> {
    return { ...this.load().overrides };
  }

  async set(repoRoot: string, config: RepoConfig | null): Promise<void> {
    return this.enqueue(async () => {
      const file = this.load();
      if (config === null) {
        delete file.overrides[repoRoot];
      } else {
        file.overrides[repoRoot] = config;
      }
      this.cache = file;
      this.persist(file);
    });
  }

  private load(): OverridesFile {
    if (this.cache) return this.cache;
    try {
      const data = JSON.parse(readFileSync(this.filePath, 'utf-8'));
      this.cache = { overrides: data.overrides ?? {} };
    } catch {
      this.cache = { overrides: {} };
    }
    return this.cache;
  }

  private enqueue<T>(fn: () => Promise<T> | T): Promise<T> {
    const result = this.writeQueue.then(fn, fn);
    this.writeQueue = result.then(
      () => {},
      () => {},
    );
    return result;
  }

  private persist(file: OverridesFile): void {
    const dir = join(this.filePath, '..');
    mkdirSync(dir, { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(file, null, 2) + '\n', 'utf-8');
  }
}
