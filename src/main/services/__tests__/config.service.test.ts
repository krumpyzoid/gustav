import { describe, it, expect, vi } from 'vitest';
import { ConfigService } from '../config.service';
import type { FileSystemPort } from '../../ports/filesystem.port';

function makeFsPort(files: Record<string, string> = {}): FileSystemPort {
  return {
    readFile: vi.fn().mockImplementation(async (p: string) => {
      if (files[p] !== undefined) return files[p];
      throw new Error(`ENOENT: ${p}`);
    }),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
    exists: vi.fn(),
    copyFile: vi.fn(),
    copyRecursive: vi.fn(),
    readlink: vi.fn(),
    watch: vi.fn(),
  };
}

describe('ConfigService', () => {
  it('reads .gustav file instead of .wt', async () => {
    const fs = makeFsPort({
      '/project/.gustav': '[tmux]\nwindow=Tests:npm test\n',
    });
    const svc = new ConfigService(fs);
    const config = await svc.parse('/project');

    expect(fs.readFile).toHaveBeenCalledWith('/project/.gustav');
    expect(config.tmux).toEqual(['Tests:npm test']);
  });

  it('returns empty config when .gustav does not exist', async () => {
    const fs = makeFsPort();
    const svc = new ConfigService(fs);
    const config = await svc.parse('/project');

    expect(config.tmux).toEqual([]);
    expect(config.env).toEqual({});
  });
});
