/**
 * Headless boot path for Gustav main.
 *
 * In headless mode, Gustav runs without a BrowserWindow. The remote protocol
 * is the only client surface. This module owns the headless flag detection,
 * the operator-facing stdout banner, and the boot orchestration.
 *
 * It is deliberately decoupled from `electron` so it can be unit-tested
 * without spinning up an Electron context. `index.ts` injects the small
 * subset of services it needs.
 *
 * See `docs/specs/headless-deployment.md` for the design context and the
 * VPS-deployment open questions this Phase 4 work doesn't yet answer.
 */

import type { RemoteService } from './remote/remote.service';
import type { StateService } from './services/state.service';
import type { ThemeService } from './services/theme.service';

export type HeadlessFlagInput = {
  env: NodeJS.ProcessEnv;
  argv: readonly string[];
};

/**
 * Pure flag detection. Either `GUSTAV_HEADLESS=1|true` or `--headless` in argv
 * activates headless mode. The env-var form matches systemd patterns and is
 * the recommended deployment surface; the CLI flag is a developer convenience.
 */
export function isHeadless(input: HeadlessFlagInput): boolean {
  const envVal = (input.env.GUSTAV_HEADLESS ?? '').toLowerCase();
  if (envVal === '1' || envVal === 'true' || envVal === 'yes') return true;
  if (input.argv.includes('--headless')) return true;
  return false;
}

export type HeadlessBannerInfo = {
  port: number | null;
  pairingCode: string | null;
  pairingExpiresAt: number | null;
  fingerprint: string | null;
};

const BANNER_PREFIX = '[gustav-headless]';

/**
 * Operator-facing stdout banner. systemd / journalctl is the only feedback
 * channel for a renderer-less Gustav, so the operator must be able to grep
 * `journalctl -u gustav` for the pairing code and the cert fingerprint.
 */
export function printHeadlessBanner(
  info: HeadlessBannerInfo,
  log: (line: string) => void = (l) => console.log(l),
): void {
  log(`${BANNER_PREFIX} Listening on :${info.port ?? '?'}`);

  if (info.pairingCode) {
    const expiresIn = info.pairingExpiresAt
      ? formatExpiry(info.pairingExpiresAt - Date.now())
      : 'unknown';
    log(`${BANNER_PREFIX} Pairing code: ${info.pairingCode} (expires in ${expiresIn})`);
  } else {
    log(`${BANNER_PREFIX} No active pairing code (regenerate from operator console)`);
  }

  log(`${BANNER_PREFIX} Server cert fingerprint: ${info.fingerprint ?? 'unavailable'}`);
}

function formatExpiry(ms: number): string {
  if (ms <= 0) return 'expired';
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) return `${hours}h${minutes > 0 ? ` ${minutes}m` : ''}`;
  if (minutes > 0) return `${minutes}m`;
  return `${totalSeconds}s`;
}

export type BootHeadlessDeps = {
  /** TCP port for the remote server. Defaults handled by caller. */
  port: number;
  remoteService: Pick<RemoteService, 'start' | 'getHostInfo' | 'broadcastState'>;
  stateService: Pick<StateService, 'onChange' | 'startPolling'>;
  themeService: Pick<ThemeService, 'setPreference' | 'startWatching' | 'onChange' | 'resolve'>;
  /**
   * Existing IPC handler registrar. In headless mode we still register IPC
   * handlers — the remote protocol's CommandDispatcher routes through the
   * same services, but a few IPC channels are also reachable from the
   * operator's perspective if anything attaches via attach-pty etc.
   */
  registerHandlers: (deps: { broadcastToRenderer: (channel: string, ...args: unknown[]) => void; [k: string]: unknown }) => void;
  registerSupervisorHandlers: (deps: { broadcastToRenderer?: (channel: string, ...args: unknown[]) => void; [k: string]: unknown }) => void;
  /**
   * Optional fingerprint accessor. Returns the SHA256 fingerprint of the
   * server's TLS certificate so the operator can verify it on first pair.
   */
  getFingerprint?: () => string | null;
  /** stdout sink (override for tests). */
  log?: (line: string) => void;
  /**
   * Sentinel for tests: the production path NEVER calls this — it exists
   * only so a test can assert it wasn't called. Production passes `undefined`.
   */
  createBrowserWindow?: (...args: unknown[]) => unknown;
  /** Extra IPC dependencies forwarded to registerHandlers. */
  handlerDeps?: Record<string, unknown>;
  /** Extra dependencies forwarded to registerSupervisorHandlers. */
  supervisorHandlerDeps?: Record<string, unknown>;
  /**
   * Optional side-effect that runs alongside `remoteService.broadcastState`
   * on every state-poll tick. Used by `index.ts` to capture Claude session
   * IDs in headless mode (the local path runs the same logic). Failures are
   * swallowed — this is a non-critical background sync.
   */
  onStateTick?: (state: unknown) => Promise<void> | void;
};

/**
 * Boots Gustav main in headless mode.
 *
 * Contract:
 * - Never calls `new BrowserWindow(...)` — the `createBrowserWindow` injected
 *   dep is here purely so tests can assert non-invocation.
 * - Starts the remote server on `deps.port`.
 * - Starts state polling and wires state changes to `remoteService.broadcastState`.
 *   No renderer broadcast (the renderer broadcaster is a no-op).
 * - Starts the theme service (per-client theme resolution still works).
 * - Registers IPC handlers and supervisor handlers with no-op renderer
 *   broadcasters. The supervisor IPC surface stays live; the remote protocol
 *   path is the consumer.
 * - Prints the pairing code + cert fingerprint to stdout.
 *
 * If `remoteService.start` throws, the error is logged and the process stays
 * alive — operators need a chance to inspect logs and fix the port conflict
 * before the supervisor restarts the unit.
 */
export async function bootHeadless(deps: BootHeadlessDeps): Promise<void> {
  const log = deps.log ?? ((l: string) => console.log(l));
  const noopBroadcast = (_channel: string, ..._args: unknown[]): void => {
    // Intentional: there is no renderer to receive these events. The remote
    // protocol consumes the same data via remoteService.broadcastState and
    // its own event channels.
  };

  // Theme: resolve and watch. Per-client theme delivery happens through the
  // remote protocol, not through renderer broadcasts.
  deps.themeService.startWatching();

  // IPC handlers — register so any IPC consumer (e.g. supervisor IPC reachable
  // through the remote protocol's command dispatcher) keeps working.
  deps.registerHandlers({
    ...deps.handlerDeps,
    broadcastToRenderer: noopBroadcast,
  });

  deps.registerSupervisorHandlers({
    ...deps.supervisorHandlerDeps,
    broadcastToRenderer: noopBroadcast,
  });

  // State polling: drive remote broadcasts only — there is no mainWindow.
  deps.stateService.onChange(async (state) => {
    deps.remoteService.broadcastState(state);
    if (deps.onStateTick) {
      try {
        await deps.onStateTick(state);
      } catch {
        // Non-critical (e.g. claude session ID capture); will retry next tick.
      }
    }
  });
  deps.stateService.startPolling();

  // Start the remote server. If this fails we report and stay up so the
  // operator can read the failure and the supervisor can trigger a restart.
  try {
    await deps.remoteService.start(deps.port);
  } catch (e) {
    const message = (e as Error).message ?? String(e);
    log(`${BANNER_PREFIX} ERROR: failed to start remote server on :${deps.port}: ${message}`);
    return;
  }

  const info = deps.remoteService.getHostInfo();
  printHeadlessBanner(
    {
      port: info.port,
      pairingCode: info.pairingCode,
      pairingExpiresAt: info.pairingExpiresAt,
      fingerprint: deps.getFingerprint?.() ?? null,
    },
    log,
  );
}
