import * as pty from 'node-pty';
import type { SupervisorPty, SupervisorPtyFactory } from './native-supervisor';

/**
 * Production spawner backed by node-pty.
 *
 * Kept in a tiny separate file so `native-supervisor.ts` stays free of any
 * direct node-pty dependency at the type level — easier to reason about for
 * a future headless mode that uses a different backend (e.g. ssh2 streams).
 */
export const nodePtyFactory: SupervisorPtyFactory = {
  spawn(command, args, options): SupervisorPty {
    const proc = pty.spawn(command, args, {
      name: options.name ?? 'xterm-256color',
      cols: options.cols ?? 80,
      rows: options.rows ?? 24,
      cwd: options.cwd,
      env: options.env as Record<string, string> | undefined,
    });
    return {
      pid: proc.pid,
      write: (data) => proc.write(data),
      resize: (cols, rows) => proc.resize(cols, rows),
      kill: (signal) => proc.kill(signal),
      onData: (cb) => proc.onData(cb),
      onExit: (cb) => proc.onExit(cb),
    };
  },
};
