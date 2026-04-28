import { watch as fsWatch, statSync, readFileSync, existsSync, type FSWatcher } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AssistantLogPort, AssistantStatus } from '../ports/assistant-log.port';

type AssistantContentItem =
  | { type: 'text'; text?: string }
  | { type: 'thinking'; thinking?: string }
  | { type: 'tool_use'; id: string; name?: string; input?: unknown };

type UserContentItem =
  | { type: 'text'; text?: string }
  | { type: 'tool_result'; tool_use_id: string; content?: unknown };

type ParsedEvent =
  | { kind: 'assistant_tool_use'; ts: number; toolUseId: string; toolName: string }
  | { kind: 'assistant_text'; ts: number }
  | { kind: 'user_tool_result'; ts: number; toolUseId: string }
  | { kind: 'other'; ts: number };

interface SessionState {
  sessionId: string;
  filePath: string;
  fileOffset: number;
  watcher: FSWatcher | null;
  lastStatus: AssistantStatus | null;
  hasAnyEvent: boolean;
  lastEvent: ParsedEvent | null;
  // tool_use_id of the most recent unmatched tool_use (if last event was assistant_tool_use)
  pendingToolUseId: string | null;
  // tool_result tool_use_ids seen so far
  resultsSeen: Set<string>;
}

const TOOL_USE_ACTION_THRESHOLD_MS = 5000;
const ASSISTANT_TEXT_DONE_THRESHOLD_MS = 3000;

interface ClaudeLogObserverOptions {
  /** Override the Claude projects root. Defaults to ~/.claude/projects. */
  projectsRoot?: string;
  /** Inject a clock for tests. */
  now?: () => number;
  /** Tick interval in ms (default 1000). */
  tickIntervalMs?: number;
}

export class ClaudeLogObserver implements AssistantLogPort {
  private readonly projectsRoot: string;
  private readonly now: () => number;
  private readonly tickIntervalMs: number;
  private readonly sessions = new Map<string, SessionState>();
  private readonly listeners = new Set<(sessionId: string, status: AssistantStatus) => void>();
  private tickHandle: ReturnType<typeof setInterval> | null = null;
  private closed = false;

  constructor(opts: ClaudeLogObserverOptions = {}) {
    this.projectsRoot = opts.projectsRoot ?? join(homedir(), '.claude', 'projects');
    this.now = opts.now ?? (() => Date.now());
    this.tickIntervalMs = opts.tickIntervalMs ?? 1000;
    this.tickHandle = setInterval(() => this.onTick(), this.tickIntervalMs);
    if (typeof (this.tickHandle as { unref?: () => void }).unref === 'function') {
      (this.tickHandle as { unref: () => void }).unref();
    }
  }

  async getStatus(sessionId: string, cwd: string): Promise<AssistantStatus | null> {
    const filePath = this.resolveLogPath(cwd, sessionId);
    if (!existsSync(filePath)) return null;

    const existing = this.sessions.get(sessionId);
    const state: SessionState =
      existing ?? {
        sessionId,
        filePath,
        fileOffset: 0,
        watcher: null,
        lastStatus: null,
        hasAnyEvent: false,
        lastEvent: null,
        pendingToolUseId: null,
        resultsSeen: new Set<string>(),
      };

    this.readNewLines(state);
    const status = this.computeStatus(state);
    return status;
  }

  onStatusChange(listener: (sessionId: string, status: AssistantStatus) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  track(sessionId: string, cwd: string): void {
    if (this.closed) return;
    if (this.sessions.has(sessionId)) return;

    const filePath = this.resolveLogPath(cwd, sessionId);
    const state: SessionState = {
      sessionId,
      filePath,
      fileOffset: 0,
      watcher: null,
      lastStatus: null,
      hasAnyEvent: false,
      lastEvent: null,
      pendingToolUseId: null,
      resultsSeen: new Set<string>(),
    };
    this.sessions.set(sessionId, state);

    if (existsSync(filePath)) {
      this.readNewLines(state);
      this.evaluateAndEmit(state);
      this.attachWatcher(state);
    }
  }

  untrack(sessionId: string): void {
    const state = this.sessions.get(sessionId);
    if (!state) return;
    if (state.watcher) {
      try {
        state.watcher.close();
      } catch {
        // Ignore cleanup errors
      }
      state.watcher = null;
    }
    this.sessions.delete(sessionId);
  }

  close(): void {
    this.closed = true;
    for (const state of this.sessions.values()) {
      if (state.watcher) {
        try {
          state.watcher.close();
        } catch {
          // Ignore cleanup errors
        }
        state.watcher = null;
      }
    }
    this.sessions.clear();
    if (this.tickHandle) {
      clearInterval(this.tickHandle);
      this.tickHandle = null;
    }
    this.listeners.clear();
  }

  /** Public test/integration hook: re-read file and re-evaluate status for a session. */
  async rescan(sessionId: string): Promise<void> {
    const state = this.sessions.get(sessionId);
    if (!state) return;
    if (!existsSync(state.filePath)) return;
    this.readNewLines(state);
    this.evaluateAndEmit(state);
    if (!state.watcher) this.attachWatcher(state);
  }

  /** Test/integration hook: read current cached status for a session, or null if untracked. */
  snapshot(sessionId: string): AssistantStatus | null {
    const state = this.sessions.get(sessionId);
    if (!state) return null;
    return this.computeStatus(state);
  }

  private resolveLogPath(cwd: string, sessionId: string): string {
    const encoded = cwd.replace(/\//g, '-');
    return join(this.projectsRoot, encoded, `${sessionId}.jsonl`);
  }

  private attachWatcher(state: SessionState): void {
    if (state.watcher) return;
    try {
      state.watcher = fsWatch(state.filePath, { persistent: false }, () => {
        if (this.closed) return;
        const live = this.sessions.get(state.sessionId);
        if (!live) return;
        try {
          this.readNewLines(live);
          this.evaluateAndEmit(live);
        } catch {
          // Defensive — never let watcher callbacks throw
        }
      });
    } catch {
      // Watch failed (e.g., file removed); re-attach attempts will happen via rescan/tick.
    }
  }

  private readNewLines(state: SessionState): void {
    let size = 0;
    try {
      size = statSync(state.filePath).size;
    } catch {
      return;
    }

    if (size < state.fileOffset) {
      // File was truncated/replaced — start over.
      state.fileOffset = 0;
      state.hasAnyEvent = false;
      state.lastEvent = null;
      state.pendingToolUseId = null;
      state.resultsSeen.clear();
    }

    if (size === state.fileOffset) return;

    let content: string;
    try {
      const buf = readFileSync(state.filePath);
      content = buf.subarray(state.fileOffset, size).toString('utf-8');
    } catch {
      return;
    }
    state.fileOffset = size;

    // Handle partial trailing line: only consume up to last newline.
    const lastNl = content.lastIndexOf('\n');
    if (lastNl === -1) {
      // No complete line yet — rewind offset so we re-read on next pass.
      state.fileOffset -= content.length;
      return;
    }
    const usable = content.slice(0, lastNl);
    const leftover = content.length - (lastNl + 1);
    state.fileOffset -= leftover;

    for (const line of usable.split('\n')) {
      if (!line.trim()) continue;
      const parsed = this.parseLine(line);
      if (!parsed) continue;
      this.applyEvent(state, parsed);
    }
  }

  private parseLine(line: string): ParsedEvent | null {
    let obj: unknown;
    try {
      obj = JSON.parse(line);
    } catch {
      return null;
    }
    if (!obj || typeof obj !== 'object') return null;

    const ev = obj as { type?: string; timestamp?: string; message?: { content?: unknown } };
    const ts = ev.timestamp ? Date.parse(ev.timestamp) : NaN;
    const tsResolved = Number.isFinite(ts) ? ts : this.now();

    if (ev.type === 'assistant') {
      const content = this.extractContent<AssistantContentItem>(ev.message?.content);
      // Prefer tool_use as the dominant content type when present.
      const toolUse = content.find((c): c is AssistantContentItem & { type: 'tool_use' } => c.type === 'tool_use');
      if (toolUse) {
        return {
          kind: 'assistant_tool_use',
          ts: tsResolved,
          toolUseId: toolUse.id,
          toolName: toolUse.name ?? 'tool',
        };
      }
      const hasText = content.some((c) => c.type === 'text' || c.type === 'thinking');
      if (hasText) {
        return { kind: 'assistant_text', ts: tsResolved };
      }
      return { kind: 'other', ts: tsResolved };
    }

    if (ev.type === 'user') {
      const content = this.extractContent<UserContentItem>(ev.message?.content);
      const result = content.find((c): c is UserContentItem & { type: 'tool_result' } => c.type === 'tool_result');
      if (result) {
        return { kind: 'user_tool_result', ts: tsResolved, toolUseId: result.tool_use_id };
      }
      return { kind: 'other', ts: tsResolved };
    }

    return { kind: 'other', ts: tsResolved };
  }

  private extractContent<T>(content: unknown): T[] {
    if (!Array.isArray(content)) return [];
    return content.filter((c): c is T => !!c && typeof c === 'object');
  }

  private applyEvent(state: SessionState, ev: ParsedEvent): void {
    state.hasAnyEvent = true;
    if (ev.kind === 'assistant_tool_use') {
      state.pendingToolUseId = ev.toolUseId;
    } else if (ev.kind === 'user_tool_result') {
      state.resultsSeen.add(ev.toolUseId);
      if (state.pendingToolUseId === ev.toolUseId) {
        state.pendingToolUseId = null;
      }
    }
    state.lastEvent = ev;
  }

  private computeStatus(state: SessionState): AssistantStatus {
    if (!state.hasAnyEvent || !state.lastEvent) {
      return { kind: 'new' };
    }
    const ev = state.lastEvent;
    const elapsed = this.now() - ev.ts;

    if (ev.kind === 'assistant_tool_use') {
      const matched = state.resultsSeen.has(ev.toolUseId);
      if (!matched && elapsed >= TOOL_USE_ACTION_THRESHOLD_MS) {
        return { kind: 'action' };
      }
      return { kind: 'busy' };
    }

    if (ev.kind === 'user_tool_result') {
      return { kind: 'busy' };
    }

    if (ev.kind === 'assistant_text') {
      if (elapsed >= ASSISTANT_TEXT_DONE_THRESHOLD_MS) {
        return { kind: 'done' };
      }
      return { kind: 'busy' };
    }

    // Other events: treat as 'done' if old, else 'busy'.
    if (elapsed >= ASSISTANT_TEXT_DONE_THRESHOLD_MS) {
      return { kind: 'done' };
    }
    return { kind: 'busy' };
  }

  private evaluateAndEmit(state: SessionState): void {
    const status = this.computeStatus(state);
    if (
      state.lastStatus === null ||
      state.lastStatus.kind !== status.kind
    ) {
      state.lastStatus = status;
      for (const listener of this.listeners) {
        try {
          listener(state.sessionId, status);
        } catch {
          // Listener errors must not break observer state machine.
        }
      }
    }
  }

  private onTick(): void {
    if (this.closed) return;
    for (const state of this.sessions.values()) {
      // No file read on tick — only re-evaluate status based on elapsed time.
      // This catches busy → done and busy → action transitions.
      this.evaluateAndEmit(state);
    }
  }
}
