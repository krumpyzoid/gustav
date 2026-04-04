import { execSync as nodeExecSync, exec as nodeExec } from 'node:child_process';
import type { ShellPort } from '../ports/shell.port';

export class ShellAdapter implements ShellPort {
  async exec(
    cmd: string,
    opts?: { cwd?: string; env?: Record<string, string>; timeout?: number },
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      nodeExec(
        cmd,
        {
          cwd: opts?.cwd,
          env: opts?.env ? { ...process.env, ...opts.env } : undefined,
          timeout: opts?.timeout ?? 30_000,
          encoding: 'utf-8',
        },
        (err, stdout) => {
          if (err) reject(err);
          else resolve(stdout.trim());
        },
      );
    });
  }

  execSync(
    cmd: string,
    opts?: { cwd?: string; encoding?: string; timeout?: number },
  ): string {
    return nodeExecSync(cmd, {
      cwd: opts?.cwd,
      encoding: (opts?.encoding as BufferEncoding) ?? 'utf-8',
      timeout: opts?.timeout ?? 30_000,
    }).trim();
  }
}
