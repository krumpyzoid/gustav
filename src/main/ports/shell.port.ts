export interface ShellPort {
  /**
   * Run `cmd` through `/bin/sh -c`. Use only for cases that genuinely require
   * shell features (pipes, redirects, glob expansion, $-expansion). Never
   * concatenate user input into `cmd` — use `execFile` instead.
   */
  exec(cmd: string, opts?: { cwd?: string; env?: Record<string, string>; timeout?: number }): Promise<string>;
  /**
   * Run `command` directly with `args[]`. Arguments are passed to `execve`
   * without shell parsing, so user input cannot become shell metacharacters.
   * This is the safe option for any command that takes user-controlled
   * parameters.
   */
  execFile(command: string, args: string[], opts?: { cwd?: string; env?: Record<string, string>; timeout?: number }): Promise<string>;
  execSync(cmd: string, opts?: { cwd?: string; encoding?: string; timeout?: number }): string;
}
