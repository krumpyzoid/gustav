export interface ShellPort {
  exec(cmd: string, opts?: { cwd?: string; env?: Record<string, string>; timeout?: number }): Promise<string>;
  execSync(cmd: string, opts?: { cwd?: string; encoding?: string; timeout?: number }): string;
}
