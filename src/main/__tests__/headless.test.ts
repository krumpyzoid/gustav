import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isHeadless, printHeadlessBanner, bootHeadless } from '../headless';

describe('isHeadless', () => {
  it('returns false when no flags are set', () => {
    expect(isHeadless({ env: {}, argv: ['node', 'index.js'] })).toBe(false);
  });

  it('returns true when GUSTAV_HEADLESS=1', () => {
    expect(isHeadless({ env: { GUSTAV_HEADLESS: '1' }, argv: [] })).toBe(true);
  });

  it('returns true when GUSTAV_HEADLESS=true', () => {
    expect(isHeadless({ env: { GUSTAV_HEADLESS: 'true' }, argv: [] })).toBe(true);
  });

  it('returns false when GUSTAV_HEADLESS=0', () => {
    expect(isHeadless({ env: { GUSTAV_HEADLESS: '0' }, argv: [] })).toBe(false);
  });

  it('returns false when GUSTAV_HEADLESS is empty', () => {
    expect(isHeadless({ env: { GUSTAV_HEADLESS: '' }, argv: [] })).toBe(false);
  });

  it('returns true when --headless flag is in argv', () => {
    expect(isHeadless({ env: {}, argv: ['node', 'index.js', '--headless'] })).toBe(true);
  });

  it('returns false when an unrelated flag is in argv', () => {
    expect(isHeadless({ env: {}, argv: ['node', 'index.js', '--something'] })).toBe(false);
  });

  it('treats env var and CLI flag as equivalent', () => {
    expect(isHeadless({ env: { GUSTAV_HEADLESS: '1' }, argv: [] })).toBe(true);
    expect(isHeadless({ env: {}, argv: ['--headless'] })).toBe(true);
  });
});

describe('printHeadlessBanner', () => {
  it('prints listening line, pairing code line, and fingerprint line', () => {
    const lines: string[] = [];
    const log = (line: string) => lines.push(line);

    printHeadlessBanner(
      {
        port: 7777,
        pairingCode: 'ABC123',
        pairingExpiresAt: Date.now() + 60_000,
        fingerprint: 'AA:BB:CC:DD',
      },
      log,
    );

    const blob = lines.join('\n');
    expect(blob).toContain('7777');
    expect(blob).toContain('ABC123');
    expect(blob).toContain('AA:BB:CC:DD');
    // Operator should be able to grep for a stable prefix
    expect(blob).toMatch(/gustav-headless/);
  });

  it('handles missing pairing code gracefully', () => {
    const lines: string[] = [];
    const log = (line: string) => lines.push(line);

    printHeadlessBanner(
      {
        port: 7777,
        pairingCode: null,
        pairingExpiresAt: null,
        fingerprint: 'XX:YY',
      },
      log,
    );

    expect(lines.some((l) => l.includes('7777'))).toBe(true);
    // No crash on null pairing code
  });

  it('mentions expiry when present', () => {
    const lines: string[] = [];
    const log = (line: string) => lines.push(line);

    printHeadlessBanner(
      {
        port: 7777,
        pairingCode: 'CODE99',
        pairingExpiresAt: Date.now() + 60 * 60 * 1000, // 1 hour
        fingerprint: 'F1:F2',
      },
      log,
    );

    const blob = lines.join('\n');
    expect(blob).toMatch(/expir/i);
  });
});

describe('bootHeadless', () => {
  let createBrowserWindow: ReturnType<typeof vi.fn>;
  let remoteService: {
    start: ReturnType<typeof vi.fn>;
    getHostInfo: ReturnType<typeof vi.fn>;
    broadcastState: ReturnType<typeof vi.fn>;
  };
  let stateService: {
    onChange: ReturnType<typeof vi.fn>;
    startPolling: ReturnType<typeof vi.fn>;
    stopPolling: ReturnType<typeof vi.fn>;
  };
  let themeService: {
    setPreference: ReturnType<typeof vi.fn>;
    startWatching: ReturnType<typeof vi.fn>;
    onChange: ReturnType<typeof vi.fn>;
    resolve: ReturnType<typeof vi.fn>;
  };
  let registerHandlers: ReturnType<typeof vi.fn>;
  let registerSupervisorHandlers: ReturnType<typeof vi.fn>;
  let logLines: string[];

  beforeEach(() => {
    createBrowserWindow = vi.fn();
    remoteService = {
      start: vi.fn().mockResolvedValue(undefined),
      getHostInfo: vi.fn().mockReturnValue({
        enabled: true,
        port: 7777,
        pairingCode: 'TEST00',
        pairingExpiresAt: Date.now() + 60_000,
        clientConnected: false,
        clientAddress: null,
      }),
      broadcastState: vi.fn(),
    };
    stateService = {
      onChange: vi.fn(),
      startPolling: vi.fn(),
      stopPolling: vi.fn(),
    };
    themeService = {
      setPreference: vi.fn(),
      startWatching: vi.fn(),
      onChange: vi.fn(),
      resolve: vi.fn().mockReturnValue({}),
    };
    registerHandlers = vi.fn();
    registerSupervisorHandlers = vi.fn();
    logLines = [];
  });

  function makeDeps(overrides: Partial<Parameters<typeof bootHeadless>[0]> = {}): Parameters<typeof bootHeadless>[0] {
    return {
      port: 7777,
      remoteService: remoteService as unknown as Parameters<typeof bootHeadless>[0]['remoteService'],
      stateService: stateService as unknown as Parameters<typeof bootHeadless>[0]['stateService'],
      themeService: themeService as unknown as Parameters<typeof bootHeadless>[0]['themeService'],
      registerHandlers: registerHandlers as unknown as Parameters<typeof bootHeadless>[0]['registerHandlers'],
      registerSupervisorHandlers: registerSupervisorHandlers as unknown as Parameters<typeof bootHeadless>[0]['registerSupervisorHandlers'],
      log: (line: string) => logLines.push(line),
      getFingerprint: () => 'AA:BB:CC',
      createBrowserWindow: createBrowserWindow as unknown as Parameters<typeof bootHeadless>[0]['createBrowserWindow'],
      ...overrides,
    };
  }

  it('does not call BrowserWindow', async () => {
    await bootHeadless(makeDeps());
    expect(createBrowserWindow).not.toHaveBeenCalled();
  });

  it('starts the remote server on the configured port', async () => {
    await bootHeadless(makeDeps({ port: 8080 }));
    expect(remoteService.start).toHaveBeenCalledWith(8080);
  });

  it('starts state polling', async () => {
    await bootHeadless(makeDeps());
    expect(stateService.startPolling).toHaveBeenCalled();
  });

  it('wires state.onChange to broadcast to the remote client (no renderer broadcast)', async () => {
    await bootHeadless(makeDeps());
    expect(stateService.onChange).toHaveBeenCalledTimes(1);
    const handler = stateService.onChange.mock.calls[0][0] as (s: unknown) => void;
    handler({ workspaces: [] });
    expect(remoteService.broadcastState).toHaveBeenCalledWith({ workspaces: [] });
  });

  it('registers IPC handlers with a no-op renderer broadcaster', async () => {
    await bootHeadless(makeDeps());
    expect(registerHandlers).toHaveBeenCalledTimes(1);
    const opts = registerHandlers.mock.calls[0][0] as {
      broadcastToRenderer: (...args: unknown[]) => void;
    };
    // Must not throw
    expect(() => opts.broadcastToRenderer('any-channel', { foo: 1 })).not.toThrow();
  });

  it('registers supervisor handlers with a no-op broadcaster', async () => {
    await bootHeadless(makeDeps());
    expect(registerSupervisorHandlers).toHaveBeenCalledTimes(1);
    const opts = registerSupervisorHandlers.mock.calls[0][0] as {
      broadcastToRenderer?: (...args: unknown[]) => void;
    };
    // Either undefined (handlers skip wiring) or a no-op — either is fine,
    // but calling it must not throw
    if (opts.broadcastToRenderer) {
      expect(() => opts.broadcastToRenderer!('x', 1)).not.toThrow();
    }
  });

  it('starts the theme service', async () => {
    await bootHeadless(makeDeps());
    expect(themeService.startWatching).toHaveBeenCalled();
  });

  it('prints the pairing code and fingerprint to stdout after boot', async () => {
    await bootHeadless(makeDeps());
    const blob = logLines.join('\n');
    expect(blob).toContain('7777');
    expect(blob).toContain('TEST00');
    expect(blob).toContain('AA:BB:CC');
  });

  it('still prints a banner if pairing code is null', async () => {
    remoteService.getHostInfo.mockReturnValue({
      enabled: true,
      port: 7777,
      pairingCode: null,
      pairingExpiresAt: null,
      clientConnected: false,
      clientAddress: null,
    });
    await bootHeadless(makeDeps());
    const blob = logLines.join('\n');
    expect(blob).toContain('7777');
    expect(blob).toContain('AA:BB:CC');
  });

  it('invokes onStateTick alongside remote broadcast on every state change', async () => {
    const onStateTick = vi.fn().mockResolvedValue(undefined);
    await bootHeadless(makeDeps({ onStateTick }));
    const handler = stateService.onChange.mock.calls[0][0] as (s: unknown) => Promise<void> | void;
    await handler({ workspaces: [] });
    expect(onStateTick).toHaveBeenCalledWith({ workspaces: [] });
    expect(remoteService.broadcastState).toHaveBeenCalledWith({ workspaces: [] });
  });

  it('swallows onStateTick errors so polling continues', async () => {
    const onStateTick = vi.fn().mockRejectedValue(new Error('tracker error'));
    await bootHeadless(makeDeps({ onStateTick }));
    const handler = stateService.onChange.mock.calls[0][0] as (s: unknown) => Promise<void> | void;
    await expect(handler({})).resolves.not.toThrow();
    // Broadcast still happened despite the tracker error
    expect(remoteService.broadcastState).toHaveBeenCalled();
  });

  it('does not throw if remote start fails — the headless process should report and stay alive for diagnosis', async () => {
    remoteService.start.mockRejectedValue(new Error('port in use'));
    await expect(bootHeadless(makeDeps())).resolves.not.toThrow();
    const blob = logLines.join('\n');
    expect(blob).toMatch(/port in use|failed/i);
  });
});
