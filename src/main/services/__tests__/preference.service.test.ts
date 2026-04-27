import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PreferenceService } from '../preference.service';

describe('PreferenceService', () => {
  let tmp: string;
  let storageDir: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'gustav-prefs-test-'));
    storageDir = join(tmp, 'gustav');
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  function writePrefsFile(content: unknown): void {
    mkdirSync(storageDir, { recursive: true });
    writeFileSync(join(storageDir, 'preferences.json'), JSON.stringify(content), 'utf-8');
  }

  describe('default tabs seeding', () => {
    it('seeds defaultTabs on first read when the file does not exist', () => {
      const svc = new PreferenceService(storageDir);
      const prefs = svc.load();

      expect(prefs.defaultTabs).toBeDefined();
      expect(prefs.defaultTabs).toHaveLength(3);
      expect(prefs.defaultTabs!.map((t) => t.name)).toEqual(['Claude Code', 'Git', 'Shell']);

      const [claude, git, shell] = prefs.defaultTabs!;
      expect(claude).toMatchObject({ name: 'Claude Code', kind: 'claude', appliesTo: 'both' });
      expect(git).toMatchObject({
        name: 'Git',
        kind: 'command',
        command: 'lazygit',
        appliesTo: 'repository',
      });
      expect(shell).toMatchObject({ name: 'Shell', kind: 'command', appliesTo: 'both' });
    });

    it('persists the seed to disk so a fresh service reads the same list', () => {
      new PreferenceService(storageDir).load();

      const onDisk = JSON.parse(
        readFileSync(join(storageDir, 'preferences.json'), 'utf-8'),
      );
      expect(onDisk.defaultTabs).toHaveLength(3);

      const svc2 = new PreferenceService(storageDir);
      const prefs2 = svc2.load();
      expect(prefs2.defaultTabs).toHaveLength(3);
    });

    it('seeds when the file exists but defaultTabs key is absent', () => {
      writePrefsFile({ theme: 'dark' });

      const svc = new PreferenceService(storageDir);
      const prefs = svc.load();

      expect(prefs.theme).toBe('dark');
      expect(prefs.defaultTabs).toHaveLength(3);
    });

    it('preserves an empty defaultTabs list (does NOT re-seed)', () => {
      writePrefsFile({ defaultTabs: [] });

      const svc = new PreferenceService(storageDir);
      const prefs = svc.load();

      expect(prefs.defaultTabs).toEqual([]);
    });

    it('preserves a user-edited list across restarts', () => {
      const userList = [
        { id: 'u1', name: 'Only Claude', kind: 'claude' as const, appliesTo: 'both' as const },
      ];
      writePrefsFile({ defaultTabs: userList });

      const svc = new PreferenceService(storageDir);
      const prefs = svc.load();

      expect(prefs.defaultTabs).toEqual(userList);
    });

    it('setDefaultTabs overwrites and persists', () => {
      const svc = new PreferenceService(storageDir);
      svc.load(); // trigger seed

      const newList = [
        { id: 'x', name: 'Logs', kind: 'command' as const, command: 'tail -f log', appliesTo: 'standalone' as const },
      ];
      svc.setDefaultTabs(newList);

      const onDisk = JSON.parse(
        readFileSync(join(storageDir, 'preferences.json'), 'utf-8'),
      );
      expect(onDisk.defaultTabs).toEqual(newList);

      // New service instance reads the saved list
      expect(new PreferenceService(storageDir).load().defaultTabs).toEqual(newList);
    });

    it('seed write does not crash when the storage directory does not exist yet', () => {
      // tmp directory exists but storageDir (tmp/gustav) does not
      expect(existsSync(storageDir)).toBe(false);
      expect(() => new PreferenceService(storageDir).load()).not.toThrow();
      expect(existsSync(join(storageDir, 'preferences.json'))).toBe(true);
    });
  });
});
