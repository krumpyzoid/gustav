import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { RepoConfigService } from '../repo-config.service';

describe('RepoConfigService', () => {
  let tmp: string;
  let storageDir: string;
  let repoRoot: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'gustav-repo-test-'));
    storageDir = join(tmp, 'gustav');
    repoRoot = join(tmp, 'my-repo');
    mkdirSync(repoRoot, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  describe('storage', () => {
    it('returns null for an unknown repo', () => {
      const svc = new RepoConfigService(storageDir);
      expect(svc.get(repoRoot)).toBeNull();
    });

    it('persists a config and reads it back', async () => {
      const svc = new RepoConfigService(storageDir);
      await svc.set(repoRoot, {
        env: { FOO: 'bar' },
        baseBranch: 'origin/main',
      });

      expect(svc.get(repoRoot)).toEqual({
        env: { FOO: 'bar' },
        baseBranch: 'origin/main',
      });
    });

    it('survives a fresh service instance', async () => {
      const svc = new RepoConfigService(storageDir);
      await svc.set(repoRoot, { postCreateCommand: 'npm install' });

      const svc2 = new RepoConfigService(storageDir);
      expect(svc2.get(repoRoot)).toEqual({ postCreateCommand: 'npm install' });
    });

    it('clears the entry when set with null', async () => {
      const svc = new RepoConfigService(storageDir);
      await svc.set(repoRoot, { baseBranch: 'origin/main' });
      await svc.set(repoRoot, null);

      expect(svc.get(repoRoot)).toBeNull();

      const onDisk = JSON.parse(
        readFileSync(join(storageDir, 'repo-overrides.json'), 'utf-8'),
      );
      expect(onDisk.overrides[repoRoot]).toBeUndefined();
    });

    it('list() returns all overrides', async () => {
      const svc = new RepoConfigService(storageDir);
      await svc.set('/a', { baseBranch: 'main' });
      await svc.set('/b', { baseBranch: 'dev' });

      expect(svc.list()).toEqual({
        '/a': { baseBranch: 'main' },
        '/b': { baseBranch: 'dev' },
      });
    });

    it('does not crash on a corrupt overrides file', () => {
      mkdirSync(storageDir, { recursive: true });
      writeFileSync(join(storageDir, 'repo-overrides.json'), '{ this is not json', 'utf-8');

      const svc = new RepoConfigService(storageDir);
      expect(svc.get(repoRoot)).toBeNull();
      expect(svc.list()).toEqual({});
    });
  });

});
