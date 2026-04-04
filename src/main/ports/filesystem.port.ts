export interface FileSystemPort {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  exists(path: string): boolean;
  mkdir(path: string): Promise<void>;
  copyFile(src: string, dest: string): Promise<void>;
  copyRecursive(src: string, dest: string): Promise<void>;
  readlink(path: string): string;
  watch(path: string, opts: { recursive?: boolean }, cb: () => void): void;
}
