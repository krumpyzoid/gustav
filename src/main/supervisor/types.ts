import type { WindowSpec } from '../domain/types';

export type ManagedWindowState = 'spawning' | 'running' | 'exited';

export interface ManagedWindow {
  /** Stable per-window id within a session. */
  readonly id: string;
  /** Display name (matches WindowSpec.name). */
  readonly name: string;
  readonly spec: WindowSpec;
  state: ManagedWindowState;
  exitCode: number | null;
}

export interface ManagedSession {
  /** Matches the Gustav session name format. */
  readonly id: string;
  readonly cwd: string;
  windows: ManagedWindow[];
  activeWindowId: string;
}

export interface ClientView {
  readonly clientId: string;
  cols: number;
  rows: number;
  /** Monotonically increasing "last activity" timestamp; supports latest-wins. */
  attachedAt: number;
}
