import { describe, it, expect, afterEach } from 'vitest';
import { ShellAdapter } from '../shell.adapter';

const SENTINEL = 'GUSTAV_SHELL_ADAPTER_TEST_SENTINEL';
const OVERLAY_ONLY = 'GUSTAV_SHELL_ADAPTER_TEST_OVERLAY_ONLY';

function readEnvScript(key: string): string {
  return `process.stdout.write(process.env[${JSON.stringify(key)}] ?? '__UNSET__')`;
}

describe('ShellAdapter — env inheritance contract', () => {
  const shell = new ShellAdapter();

  afterEach(() => {
    delete process.env[SENTINEL];
    delete process.env[OVERLAY_ONLY];
  });

  it('execFile inherits process.env when caller passes no opts', async () => {
    process.env[SENTINEL] = 'ambient-value';
    const out = await shell.execFile(process.execPath, ['-e', readEnvScript(SENTINEL)]);
    expect(out).toBe('ambient-value');
  });

  it('execFile inherits process.env when opts is provided without env', async () => {
    process.env[SENTINEL] = 'ambient-value';
    const out = await shell.execFile(process.execPath, ['-e', readEnvScript(SENTINEL)], {
      timeout: 5000,
    });
    expect(out).toBe('ambient-value');
  });

  it('execFile overlays opts.env on top of process.env (overlay wins, ambient remains)', async () => {
    process.env[SENTINEL] = 'ambient-value';
    const overlaidScript = `process.stdout.write([
      process.env[${JSON.stringify(SENTINEL)}] ?? '__UNSET__',
      process.env[${JSON.stringify(OVERLAY_ONLY)}] ?? '__UNSET__',
    ].join('|'))`;
    const out = await shell.execFile(
      process.execPath,
      ['-e', overlaidScript],
      { env: { [OVERLAY_ONLY]: 'overlay-value' } },
    );
    // Ambient sentinel still visible, overlay-only also visible.
    expect(out).toBe('ambient-value|overlay-value');
  });

  it('execFile overlay can shadow ambient values', async () => {
    process.env[SENTINEL] = 'ambient-value';
    const out = await shell.execFile(process.execPath, ['-e', readEnvScript(SENTINEL)], {
      env: { [SENTINEL]: 'overlay-value' },
    });
    expect(out).toBe('overlay-value');
  });

  // exec runs through /bin/sh -c — printenv is a clean way to read env without
  // the quoting headaches of a node -e script wrapped in a shell string.
  it('exec inherits process.env when caller passes no opts', async () => {
    process.env[SENTINEL] = 'ambient-value';
    const out = await shell.exec(`printenv ${SENTINEL}`);
    expect(out).toBe('ambient-value');
  });

  it('exec overlays opts.env on top of process.env (ambient remains)', async () => {
    process.env[SENTINEL] = 'ambient-value';
    const out = await shell.exec(`printenv ${SENTINEL} ${OVERLAY_ONLY}`, {
      env: { [OVERLAY_ONLY]: 'overlay-value' },
    });
    expect(out).toBe('ambient-value\noverlay-value');
  });
});
