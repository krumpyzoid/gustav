/**
 * Test fake for node-pty.
 *
 * Provides a `spawn` function whose return value mimics the `IPty` shape
 * (`pid`, `write`, `resize`, `kill`, `onData`, `onExit`) and exposes test
 * hooks (`emit`, `exit`, `lastResize`, `writes`) for assertions.
 *
 * The supervisor under test never imports node-pty directly — it consumes
 * a `PtySpawner` injection, defaulting to the real one in production. This
 * file is the test-side spawner.
 */

export interface FakePtySpawnArgs {
  command: string;
  args: string[];
  cwd: string;
  cols: number;
  rows: number;
  env: Record<string, string>;
  name: string;
}

export interface FakePty {
  pid: number;
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  kill: (signal?: string) => void;
  onData: (cb: (data: string) => void) => { dispose: () => void };
  onExit: (cb: (e: { exitCode: number; signal?: number }) => void) => { dispose: () => void };

  // Test hooks
  emit: (data: string) => void;
  exit: (exitCode: number) => void;
  readonly spawnArgs: FakePtySpawnArgs;
  readonly writes: string[];
  readonly resizes: Array<{ cols: number; rows: number }>;
  readonly killed: boolean;
  cols: number;
  rows: number;
}

export interface FakePtyFactory {
  spawn: (
    command: string,
    args: string[],
    options: {
      cwd?: string;
      cols?: number;
      rows?: number;
      env?: Record<string, string>;
      name?: string;
    },
  ) => FakePty;
  /** All ptys ever created by this factory, in spawn order. */
  readonly all: FakePty[];
}

let nextPid = 10000;

export function createFakePtyFactory(): FakePtyFactory {
  const all: FakePty[] = [];

  function spawn(
    command: string,
    args: string[],
    options: {
      cwd?: string;
      cols?: number;
      rows?: number;
      env?: Record<string, string>;
      name?: string;
    } = {},
  ): FakePty {
    const dataListeners: Array<(data: string) => void> = [];
    const exitListeners: Array<(e: { exitCode: number; signal?: number }) => void> = [];
    let killed = false;
    let exited = false;

    const fake: FakePty = {
      pid: ++nextPid,
      write(data: string) {
        if (killed || exited) return;
        fake.writes.push(data);
      },
      resize(cols: number, rows: number) {
        if (killed || exited) return;
        fake.cols = cols;
        fake.rows = rows;
        fake.resizes.push({ cols, rows });
      },
      kill(_signal?: string) {
        if (killed) return;
        killed = true;
        // Fire exit listeners on kill (matches real node-pty behavior).
        for (const cb of exitListeners) cb({ exitCode: 0 });
        exited = true;
      },
      onData(cb: (data: string) => void) {
        dataListeners.push(cb);
        return {
          dispose() {
            const idx = dataListeners.indexOf(cb);
            if (idx >= 0) dataListeners.splice(idx, 1);
          },
        };
      },
      onExit(cb: (e: { exitCode: number; signal?: number }) => void) {
        exitListeners.push(cb);
        return {
          dispose() {
            const idx = exitListeners.indexOf(cb);
            if (idx >= 0) exitListeners.splice(idx, 1);
          },
        };
      },
      emit(data: string) {
        if (killed || exited) return;
        for (const cb of dataListeners) cb(data);
      },
      exit(exitCode: number) {
        if (exited) return;
        exited = true;
        for (const cb of exitListeners) cb({ exitCode });
      },
      get killed() {
        return killed;
      },
      cols: options.cols ?? 80,
      rows: options.rows ?? 24,
      spawnArgs: {
        command,
        args,
        cwd: options.cwd ?? '/',
        cols: options.cols ?? 80,
        rows: options.rows ?? 24,
        env: options.env ?? {},
        name: options.name ?? 'xterm-256color',
      },
      writes: [],
      resizes: [],
    };

    all.push(fake);
    return fake;
  }

  return { spawn, all };
}
