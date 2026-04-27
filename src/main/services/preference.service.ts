import { join } from 'node:path';
import { homedir } from 'node:os';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { Preferences } from '../domain/types';
import type { TabConfig } from '../domain/tab-config';

const DEFAULT_STORAGE_DIR = join(homedir(), '.local', 'share', 'gustav');

/** Factory for the seed list — exported for tests and slice C migration. */
export function seedDefaultTabs(): TabConfig[] {
  return [
    { id: randomUUID(), name: 'Claude Code', kind: 'claude', appliesTo: 'both' },
    { id: randomUUID(), name: 'Git', kind: 'command', command: 'lazygit', appliesTo: 'repository' },
    { id: randomUUID(), name: 'Shell', kind: 'command', appliesTo: 'both' },
  ];
}

export class PreferenceService {
  private filePath: string;
  private cache: Preferences | null = null;

  constructor(storageDir?: string) {
    this.filePath = join(storageDir ?? DEFAULT_STORAGE_DIR, 'preferences.json');
  }

  load(): Preferences {
    if (this.cache) return this.cache;

    let prefs: Preferences;
    try {
      prefs = JSON.parse(readFileSync(this.filePath, 'utf-8'));
    } catch {
      prefs = {};
    }

    // Seed defaultTabs if the key is absent (missing entirely, not just empty).
    if (!('defaultTabs' in prefs)) {
      prefs = { ...prefs, defaultTabs: seedDefaultTabs() };
      try {
        this.save(prefs);
      } catch {
        // Seed write is best-effort; in-memory seed is still returned.
      }
    }

    this.cache = prefs;
    return prefs;
  }

  set<K extends keyof Preferences>(key: K, value: Preferences[K]): Preferences {
    const prefs = this.load();
    prefs[key] = value;
    this.cache = prefs;
    this.save(prefs);
    return prefs;
  }

  setDefaultTabs(tabs: TabConfig[]): void {
    const prefs = this.load();
    prefs.defaultTabs = tabs;
    this.cache = prefs;
    this.save(prefs);
  }

  private save(prefs: Preferences): void {
    const dir = join(this.filePath, '..');
    mkdirSync(dir, { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(prefs, null, 2), 'utf-8');
  }
}
