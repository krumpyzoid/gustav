export type AssistantStatus =
  | { kind: 'busy' }
  | { kind: 'action' }
  | { kind: 'done' }
  | { kind: 'new' };

export interface AssistantLogPort {
  /** Read latest status for a given sessionId+cwd. Returns null when no log exists yet. */
  getStatus(sessionId: string, cwd: string): Promise<AssistantStatus | null>;
  /** Subscribe to status changes. Returns unsubscribe fn. */
  onStatusChange(listener: (sessionId: string, status: AssistantStatus) => void): () => void;
  /** Start tracking a session — begins watching the corresponding JSONL file. */
  track(sessionId: string, cwd: string): void;
  /** Stop tracking a session — stops watching. */
  untrack(sessionId: string): void;
  /** Tear down all watchers. */
  close(): void;
}
