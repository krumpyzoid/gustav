import { ipcMain } from 'electron';
import { Channels } from './channels';
import type { SessionSupervisorPort } from '../supervisor/supervisor.port';
import type { Result, WindowSpec } from '../domain/types';

function ok<T>(data: T): Result<T> {
  return { success: true, data };
}

function err(message: string): Result<never> {
  return { success: false, error: message };
}

/**
 * Wire the supervisor instance to Electron IPC. The supervisor itself is
 * Electron-free — this file is the Electron glue.
 *
 * Only mounted on the main side; the renderer reaches these handlers via
 * preload methods (window.api.supervisor*).
 */
export function registerSupervisorHandlers(deps: {
  supervisor: SessionSupervisorPort;
  broadcastToRenderer?: (channel: string, ...args: unknown[]) => void;
}): void {
  const { supervisor, broadcastToRenderer } = deps;

  // ── Session lifecycle ─────────────────────────────────────────────
  ipcMain.handle(
    Channels.SUPERVISOR_CREATE_SESSION,
    async (_event, opts: { sessionId: string; cwd: string; windows: WindowSpec[] }) => {
      try {
        await supervisor.createSession(opts);
        return ok(undefined);
      } catch (e) {
        return err((e as Error).message);
      }
    },
  );

  ipcMain.handle(Channels.SUPERVISOR_KILL_SESSION, async (_event, sessionId: string) => {
    try {
      await supervisor.killSession(sessionId);
      return ok(undefined);
    } catch (e) {
      return err((e as Error).message);
    }
  });

  ipcMain.handle(Channels.SUPERVISOR_HAS_SESSION, (_event, sessionId: string) => {
    return ok(supervisor.hasSession(sessionId));
  });

  // ── Window lifecycle ──────────────────────────────────────────────
  ipcMain.handle(
    Channels.SUPERVISOR_ADD_WINDOW,
    async (_event, sessionId: string, spec: WindowSpec) => {
      try {
        const id = await supervisor.addWindow(sessionId, spec);
        return ok(id);
      } catch (e) {
        return err((e as Error).message);
      }
    },
  );

  ipcMain.handle(
    Channels.SUPERVISOR_KILL_WINDOW,
    async (_event, sessionId: string, windowId: string) => {
      try {
        await supervisor.killWindow(sessionId, windowId);
        return ok(undefined);
      } catch (e) {
        return err((e as Error).message);
      }
    },
  );

  ipcMain.handle(
    Channels.SUPERVISOR_SELECT_WINDOW,
    async (_event, sessionId: string, windowId: string) => {
      try {
        await supervisor.selectWindow(sessionId, windowId);
        return ok(undefined);
      } catch (e) {
        return err((e as Error).message);
      }
    },
  );

  ipcMain.handle(Channels.SUPERVISOR_LIST_WINDOWS, (_event, sessionId: string) => {
    return ok(supervisor.listWindows(sessionId));
  });

  // ── Sleep / wake ──────────────────────────────────────────────────
  ipcMain.handle(Channels.SUPERVISOR_SLEEP, async (_event, sessionId: string) => {
    try {
      await supervisor.sleepSession(sessionId);
      return ok(undefined);
    } catch (e) {
      return err((e as Error).message);
    }
  });

  ipcMain.handle(Channels.SUPERVISOR_WAKE, async (_event, sessionId: string) => {
    try {
      await supervisor.wakeSession(sessionId);
      return ok(undefined);
    } catch (e) {
      return err((e as Error).message);
    }
  });

  // ── Client management ─────────────────────────────────────────────
  ipcMain.on(
    Channels.SUPERVISOR_ATTACH_CLIENT,
    (
      _event,
      payload: { sessionId: string; clientId: string; cols: number; rows: number },
    ) => {
      try {
        supervisor.attachClient(payload);
      } catch {
        // Best-effort; renderer doesn't await these.
      }
    },
  );

  ipcMain.on(
    Channels.SUPERVISOR_DETACH_CLIENT,
    (_event, sessionId: string, clientId: string) => {
      supervisor.detachClient(sessionId, clientId);
    },
  );

  ipcMain.on(
    Channels.SUPERVISOR_RESIZE_CLIENT,
    (
      _event,
      payload: { sessionId: string; clientId: string; cols: number; rows: number },
    ) => {
      supervisor.resizeClient(payload.sessionId, payload.clientId, payload.cols, payload.rows);
    },
  );

  // ── Data plane ────────────────────────────────────────────────────
  ipcMain.on(Channels.SUPERVISOR_INPUT, (_event, sessionId: string, data: string) => {
    supervisor.sendInput(sessionId, data);
  });

  ipcMain.handle(
    Channels.SUPERVISOR_REPLAY,
    (_event, sessionId: string, windowId: string) => {
      return ok(supervisor.getReplay(sessionId, windowId));
    },
  );

  // ── Events (main → renderer) ──────────────────────────────────────
  if (broadcastToRenderer) {
    supervisor.onWindowData((sessionId, windowId, data) => {
      broadcastToRenderer(Channels.SUPERVISOR_ON_DATA, { sessionId, windowId, data });
    });
    supervisor.onSessionStateChange((sessionId) => {
      broadcastToRenderer(Channels.SUPERVISOR_ON_STATE_CHANGE, { sessionId });
    });
  }
}
