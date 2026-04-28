import type { WindowSpec } from '../domain/types';
import type { ManagedWindow } from './types';

/**
 * Port describing the SessionSupervisor surface.
 *
 * The supervisor is the single arbiter of PTY lifecycle and size for a set
 * of sessions. It is intentionally Electron-free so a future headless-mode
 * deployment can use it directly without a renderer.
 */
export interface SessionSupervisorPort {
  // ── Session lifecycle ─────────────────────────────────────────────
  createSession(opts: { sessionId: string; cwd: string; windows: WindowSpec[] }): Promise<void>;
  killSession(sessionId: string): Promise<void>;
  hasSession(sessionId: string): boolean;
  /** List the ids of every active session the supervisor owns. */
  listSessions(): string[];

  // ── Window lifecycle ──────────────────────────────────────────────
  /** Returns the new window's stable id. */
  addWindow(sessionId: string, spec: WindowSpec): Promise<string>;
  killWindow(sessionId: string, windowId: string): Promise<void>;
  selectWindow(sessionId: string, windowId: string): Promise<void>;
  listWindows(sessionId: string): ManagedWindow[];

  // ── Sleep / wake ──────────────────────────────────────────────────
  /** Kill PTYs but retain the spec, so wake() can respawn. */
  sleepSession(sessionId: string): Promise<void>;
  /** Respawn PTYs from the retained spec. */
  wakeSession(sessionId: string): Promise<void>;

  // ── Client management ─────────────────────────────────────────────
  // Multiple clients can attach to the same session; resize is latest-wins.
  attachClient(opts: { sessionId: string; clientId: string; cols: number; rows: number }): void;
  detachClient(sessionId: string, clientId: string): void;
  resizeClient(sessionId: string, clientId: string, cols: number, rows: number): void;

  // ── Data plane ────────────────────────────────────────────────────
  /** Routes input to the active window. */
  sendInput(sessionId: string, data: string): void;
  onWindowData(listener: (sessionId: string, windowId: string, data: string) => void): () => void;
  onSessionStateChange(listener: (sessionId: string) => void): () => void;

  // ── Replay ────────────────────────────────────────────────────────
  /** Get the buffered scrollback for a window (raw bytes, capped). */
  getReplay(sessionId: string, windowId: string): string;

  /** Tear down all sessions and listeners. */
  close(): void;
}
