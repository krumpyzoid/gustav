import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { RegistryService } from '../registry.service';
import type { FileSystemPort } from '../../ports/filesystem.port';

function makeFsPort(): FileSystemPort {
  const { readFile, writeFile, mkdir, copyFile } = require('node:fs/promises');
  const { existsSync, readlinkSync } = require('node:fs');
  const { cp } = require('node:fs/promises');
  return {
    readFile: (p: string) => readFile(p, 'utf-8'),
    writeFile: (p: string, c: string) => writeFile(p, c, 'utf-8'),
    mkdir: (p: string) => mkdir(p, { recursive: true }),
    exists: (p: string) => existsSync(p),
    copyFile: (s: string, d: string) => copyFile(s, d),
    copyRecursive: (s: string, d: string) => cp(s, d, { recursive: true }),
    readlink: (p: string) => readlinkSync(p),
    watch: () => {},
  };
}

describe('RegistryService', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'gustav-test-'));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  describe('discoverGitRepos', () => {
    it('returns the folder itself if it is a git repo', () => {
      mkdirSync(join(tmp, '.git'));
      const svc = new RegistryService(makeFsPort());
      const repos = svc.discoverGitRepos(tmp, 3);
      expect(repos).toEqual([tmp]);
    });

    it('finds nested git repos recursively', () => {
      const repoA = join(tmp, 'a');
      const repoB = join(tmp, 'group', 'b');
      mkdirSync(join(repoA, '.git'), { recursive: true });
      mkdirSync(join(repoB, '.git'), { recursive: true });

      const svc = new RegistryService(makeFsPort());
      const repos = svc.discoverGitRepos(tmp, 3);
      expect(repos.sort()).toEqual([repoA, repoB].sort());
    });

    it('does not descend beyond maxDepth', () => {
      const deep = join(tmp, 'a', 'b', 'c', 'd');
      mkdirSync(join(deep, '.git'), { recursive: true });

      const svc = new RegistryService(makeFsPort());
      // depth 3: tmp(0) -> a(1) -> b(2) -> c(3) -> d(4) — too deep
      const repos = svc.discoverGitRepos(tmp, 3);
      expect(repos).toEqual([]);
    });

    it('skips node_modules and hidden directories', () => {
      mkdirSync(join(tmp, 'node_modules', 'pkg', '.git'), { recursive: true });
      mkdirSync(join(tmp, '.hidden', '.git'), { recursive: true });
      const validRepo = join(tmp, 'valid');
      mkdirSync(join(validRepo, '.git'), { recursive: true });

      const svc = new RegistryService(makeFsPort());
      const repos = svc.discoverGitRepos(tmp, 3);
      expect(repos).toEqual([validRepo]);
    });

    it('does not descend into a folder that is itself a git repo', () => {
      // If parent has .git, don't look inside for more repos
      mkdirSync(join(tmp, '.git'));
      mkdirSync(join(tmp, 'sub', '.git'), { recursive: true });

      const svc = new RegistryService(makeFsPort());
      const repos = svc.discoverGitRepos(tmp, 3);
      expect(repos).toEqual([tmp]);
    });
  });

  describe('pinMany', () => {
    it('saves multiple repos to the registry', async () => {
      const repoA = join(tmp, 'alpha');
      const repoB = join(tmp, 'beta');
      mkdirSync(repoA);
      mkdirSync(repoB);

      const registryDir = join(tmp, 'registry');
      const svc = new RegistryService(makeFsPort(), registryDir);

      await svc.pinMany([repoA, repoB]);
      const registry = svc.load();
      expect(registry['alpha']).toBe(repoA);
      expect(registry['beta']).toBe(repoB);
    });

    it('does not duplicate already-pinned repos', async () => {
      const repoA = join(tmp, 'alpha');
      mkdirSync(repoA);

      const registryDir = join(tmp, 'registry');
      const svc = new RegistryService(makeFsPort(), registryDir);

      await svc.pinMany([repoA]);
      await svc.pinMany([repoA]);
      const registry = svc.load();
      expect(Object.keys(registry)).toEqual(['alpha']);
    });
  });
});
