import {
  readFileSync,
  existsSync,
  readlinkSync,
  watch as fsWatch,
} from 'node:fs';
import { readFile, writeFile, mkdir, copyFile, cp } from 'node:fs/promises';
import type { FileSystemPort } from '../ports/filesystem.port';

export class FsAdapter implements FileSystemPort {
  async readFile(path: string): Promise<string> {
    return readFile(path, 'utf-8');
  }

  async writeFile(path: string, content: string): Promise<void> {
    await writeFile(path, content, 'utf-8');
  }

  exists(path: string): boolean {
    return existsSync(path);
  }

  async mkdir(path: string): Promise<void> {
    await mkdir(path, { recursive: true });
  }

  async copyFile(src: string, dest: string): Promise<void> {
    await copyFile(src, dest);
  }

  async copyRecursive(src: string, dest: string): Promise<void> {
    await cp(src, dest, { recursive: true });
  }

  readlink(path: string): string {
    return readlinkSync(path);
  }

  watch(path: string, opts: { recursive?: boolean }, cb: () => void): void {
    try {
      fsWatch(path, { persistent: false, recursive: opts.recursive ?? false }, cb);
    } catch {
      // Silently ignore watch errors (directory may not exist yet)
    }
  }
}
