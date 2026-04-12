import { join } from 'node:path';
import { homedir } from 'node:os';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import type { Preferences } from '../domain/types';

const DEFAULT_STORAGE_DIR = join(homedir(), '.local', 'share', 'gustav');

export class PreferenceService {
  private filePath: string;
  private cache: Preferences | null = null;

  constructor(storageDir?: string) {
    this.filePath = join(storageDir ?? DEFAULT_STORAGE_DIR, 'preferences.json');
  }

  load(): Preferences {
    if (this.cache) return this.cache;
    try {
      this.cache = JSON.parse(readFileSync(this.filePath, 'utf-8'));
      return this.cache!;
    } catch {
      return {};
    }
  }

  set<K extends keyof Preferences>(key: K, value: Preferences[K]): Preferences {
    const prefs = this.load();
    prefs[key] = value;
    this.cache = prefs;
    this.save(prefs);
    return prefs;
  }

  private save(prefs: Preferences): void {
    const dir = join(this.filePath, '..');
    mkdirSync(dir, { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(prefs, null, 2), 'utf-8');
  }
}
