import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { WorkspaceService } from '../workspace.service';
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

describe('WorkspaceService', () => {
  let tmp: string;
  let storageDir: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'gustav-ws-test-'));
    storageDir = join(tmp, 'gustav');
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('creates a workspace and persists it', async () => {
    const svc = new WorkspaceService(makeFsPort(), storageDir);
    const ws = await svc.create('My Project', '/home/user/myproject');

    expect(ws.name).toBe('My Project');
    expect(ws.directory).toBe('/home/user/myproject');
    expect(ws.id).toBeTruthy();

    const all = svc.list();
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe('My Project');
  });

  it('lists workspaces from persisted file', async () => {
    const svc = new WorkspaceService(makeFsPort(), storageDir);
    await svc.create('A', '/path/a');
    await svc.create('B', '/path/b');

    // New instance reads from disk
    const svc2 = new WorkspaceService(makeFsPort(), storageDir);
    const all = svc2.list();
    expect(all).toHaveLength(2);
    expect(all.map((w) => w.name).sort()).toEqual(['A', 'B']);
  });

  it('rejects duplicate directory', async () => {
    const svc = new WorkspaceService(makeFsPort(), storageDir);
    await svc.create('First', '/home/user/project');
    await expect(svc.create('Second', '/home/user/project')).rejects.toThrow(
      /already exists/i,
    );
  });

  it('renames a workspace', async () => {
    const svc = new WorkspaceService(makeFsPort(), storageDir);
    const ws = await svc.create('Old Name', '/path/to/dir');
    await svc.rename(ws.id, 'New Name');

    const all = svc.list();
    expect(all[0].name).toBe('New Name');
  });

  it('removes a workspace', async () => {
    const svc = new WorkspaceService(makeFsPort(), storageDir);
    const ws = await svc.create('ToDelete', '/path/del');
    await svc.remove(ws.id);

    expect(svc.list()).toHaveLength(0);
  });

  it('findByDirectory returns matching workspace', async () => {
    const svc = new WorkspaceService(makeFsPort(), storageDir);
    await svc.create('Found', '/specific/path');

    const found = svc.findByDirectory('/specific/path');
    expect(found).toBeDefined();
    expect(found!.name).toBe('Found');
  });

  it('findByDirectory returns undefined for no match', async () => {
    const svc = new WorkspaceService(makeFsPort(), storageDir);
    expect(svc.findByDirectory('/nonexistent')).toBeUndefined();
  });

  describe('discoverGitRepos', () => {
    it('finds nested git repos recursively', () => {
      const repoA = join(tmp, 'a');
      const repoB = join(tmp, 'group', 'b');
      mkdirSync(join(repoA, '.git'), { recursive: true });
      mkdirSync(join(repoB, '.git'), { recursive: true });

      const svc = new WorkspaceService(makeFsPort(), storageDir);
      const repos = svc.discoverGitRepos(tmp, 3);
      expect(repos.sort()).toEqual([repoA, repoB].sort());
    });

    it('returns the folder itself if it is a git repo', () => {
      mkdirSync(join(tmp, '.git'));
      const svc = new WorkspaceService(makeFsPort(), storageDir);
      const repos = svc.discoverGitRepos(tmp, 3);
      expect(repos).toEqual([tmp]);
    });

    it('skips node_modules and hidden directories', () => {
      mkdirSync(join(tmp, 'node_modules', 'pkg', '.git'), { recursive: true });
      mkdirSync(join(tmp, '.hidden', '.git'), { recursive: true });
      const validRepo = join(tmp, 'valid');
      mkdirSync(join(validRepo, '.git'), { recursive: true });

      const svc = new WorkspaceService(makeFsPort(), storageDir);
      const repos = svc.discoverGitRepos(tmp, 3);
      expect(repos).toEqual([validRepo]);
    });
  });
});
