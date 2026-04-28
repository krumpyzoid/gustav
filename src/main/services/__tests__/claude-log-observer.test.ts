import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClaudeLogObserver } from '../claude-log-observer';
import type { AssistantStatus } from '../../ports/assistant-log.port';

let tempRoot: string;
let now = 1_700_000_000_000;

function isoFromNow(offsetMs = 0): string {
  return new Date(now + offsetMs).toISOString();
}

function encodedDir(cwd: string): string {
  return cwd.replace(/\//g, '-');
}

function jsonlPath(cwd: string, sessionId: string): string {
  return join(tempRoot, encodedDir(cwd), `${sessionId}.jsonl`);
}

function ensureSessionDir(cwd: string): void {
  mkdirSync(join(tempRoot, encodedDir(cwd)), { recursive: true });
}

function writeLine(cwd: string, sessionId: string, obj: unknown): void {
  ensureSessionDir(cwd);
  appendFileSync(jsonlPath(cwd, sessionId), JSON.stringify(obj) + '\n');
}

function makeAssistantText(sessionId: string, text: string, ts = isoFromNow()): unknown {
  return {
    type: 'assistant',
    sessionId,
    uuid: `u-${Math.random().toString(36).slice(2)}`,
    timestamp: ts,
    message: { content: [{ type: 'text', text }] },
  };
}

function makeAssistantToolUse(sessionId: string, toolUseId: string, name = 'Bash', ts = isoFromNow()): unknown {
  return {
    type: 'assistant',
    sessionId,
    uuid: `u-${Math.random().toString(36).slice(2)}`,
    timestamp: ts,
    message: { content: [{ type: 'tool_use', id: toolUseId, name, input: {} }] },
  };
}

function makeUserToolResult(sessionId: string, toolUseId: string, ts = isoFromNow()): unknown {
  return {
    type: 'user',
    sessionId,
    uuid: `u-${Math.random().toString(36).slice(2)}`,
    timestamp: ts,
    message: { content: [{ type: 'tool_result', tool_use_id: toolUseId, content: 'ok' }] },
  };
}

describe('ClaudeLogObserver', () => {
  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'gustav-claude-log-'));
    now = 1_700_000_000_000;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  function makeObserver(): ClaudeLogObserver {
    return new ClaudeLogObserver({
      projectsRoot: tempRoot,
      now: () => now,
    });
  }

  it('returns null when log file does not exist', async () => {
    const observer = makeObserver();
    const result = await observer.getStatus('session-x', '/home/u/repo');
    expect(result).toBeNull();
    observer.close();
  });

  it('returns new when file exists but has no events', async () => {
    ensureSessionDir('/home/u/repo');
    writeFileSync(jsonlPath('/home/u/repo', 'session-y'), '');
    const observer = makeObserver();
    const result = await observer.getStatus('session-y', '/home/u/repo');
    expect(result).toEqual({ kind: 'new' });
    observer.close();
  });

  it('reports busy when most recent event is assistant text within 3 seconds', async () => {
    const sessionId = 's1';
    const cwd = '/home/u/repo';
    writeLine(cwd, sessionId, makeAssistantText(sessionId, 'Working on it'));

    const observer = makeObserver();
    observer.track(sessionId, cwd);
    await observer.rescan(sessionId);

    expect(observer.snapshot(sessionId)).toEqual({ kind: 'busy' });
    observer.close();
  });

  it('reports busy when most recent event is a recent tool_use (<5s)', async () => {
    const sessionId = 's2';
    const cwd = '/home/u/repo';
    writeLine(cwd, sessionId, makeAssistantToolUse(sessionId, 'tool-1', 'Bash'));

    const observer = makeObserver();
    observer.track(sessionId, cwd);
    await observer.rescan(sessionId);

    expect(observer.snapshot(sessionId)).toEqual({ kind: 'busy' });
    observer.close();
  });

  it('transitions to action when a tool_use sits idle past 5 seconds with no result', async () => {
    const sessionId = 's3';
    const cwd = '/home/u/repo';
    writeLine(cwd, sessionId, makeAssistantToolUse(sessionId, 'tool-A', 'Bash'));

    const observer = makeObserver();
    const events: Array<{ id: string; status: AssistantStatus }> = [];
    observer.onStatusChange((id, status) => events.push({ id, status }));

    observer.track(sessionId, cwd);
    await observer.rescan(sessionId);
    expect(observer.snapshot(sessionId)).toEqual({ kind: 'busy' });

    // Advance past 5s threshold
    now += 6000;
    vi.advanceTimersByTime(1000);

    expect(observer.snapshot(sessionId)).toEqual({ kind: 'action' });
    expect(events.some((e) => e.status.kind === 'action')).toBe(true);
    observer.close();
  });

  it('reports busy when most recent event is a tool_result', async () => {
    const sessionId = 's4';
    const cwd = '/home/u/repo';
    writeLine(cwd, sessionId, makeAssistantToolUse(sessionId, 'tool-A'));
    writeLine(cwd, sessionId, makeUserToolResult(sessionId, 'tool-A'));

    const observer = makeObserver();
    observer.track(sessionId, cwd);
    await observer.rescan(sessionId);

    expect(observer.snapshot(sessionId)).toEqual({ kind: 'busy' });
    observer.close();
  });

  it('transitions to done after assistant text idle for >3 seconds', async () => {
    const sessionId = 's5';
    const cwd = '/home/u/repo';
    writeLine(cwd, sessionId, makeAssistantText(sessionId, 'Here is the answer'));

    const observer = makeObserver();
    const events: AssistantStatus[] = [];
    observer.onStatusChange((_id, status) => events.push(status));

    observer.track(sessionId, cwd);
    await observer.rescan(sessionId);
    expect(observer.snapshot(sessionId)).toEqual({ kind: 'busy' });

    now += 3500;
    vi.advanceTimersByTime(1000);

    expect(observer.snapshot(sessionId)).toEqual({ kind: 'done' });
    expect(events).toContainEqual({ kind: 'busy' });
    expect(events).toContainEqual({ kind: 'done' });
    observer.close();
  });

  it('emits onStatusChange only on transitions, not on every tick', async () => {
    const sessionId = 's6';
    const cwd = '/home/u/repo';
    writeLine(cwd, sessionId, makeAssistantText(sessionId, 'Done'));

    const observer = makeObserver();
    const calls: AssistantStatus[] = [];
    observer.onStatusChange((_id, status) => calls.push(status));

    observer.track(sessionId, cwd);
    await observer.rescan(sessionId);
    const initialCount = calls.length;

    // Repeated ticks while still busy — no new events
    vi.advanceTimersByTime(1000);
    vi.advanceTimersByTime(1000);
    expect(calls.length).toBe(initialCount);

    // Advance past 3s — should emit one done transition
    now += 4000;
    vi.advanceTimersByTime(1000);
    expect(calls.length).toBe(initialCount + 1);
    expect(calls[calls.length - 1]).toEqual({ kind: 'done' });

    // Further ticks — no extra emissions
    vi.advanceTimersByTime(1000);
    vi.advanceTimersByTime(1000);
    expect(calls.length).toBe(initialCount + 1);
    observer.close();
  });

  it('getStatus returns null when called before any tracking and no file exists', async () => {
    const observer = makeObserver();
    expect(await observer.getStatus('unknown', '/nope')).toBeNull();
    observer.close();
  });

  it('getStatus reads the file even without prior track() call', async () => {
    const sessionId = 's7';
    const cwd = '/home/u/repo';
    writeLine(cwd, sessionId, makeAssistantText(sessionId, 'hello'));

    const observer = makeObserver();
    const status = await observer.getStatus(sessionId, cwd);
    expect(status).toEqual({ kind: 'busy' });
    observer.close();
  });

  it('untrack stops watching and removes session state', async () => {
    const sessionId = 's8';
    const cwd = '/home/u/repo';
    writeLine(cwd, sessionId, makeAssistantText(sessionId, 'hi'));

    const observer = makeObserver();
    observer.track(sessionId, cwd);
    await observer.rescan(sessionId);
    expect(observer.snapshot(sessionId)).toEqual({ kind: 'busy' });

    observer.untrack(sessionId);
    expect(observer.snapshot(sessionId)).toBeNull();

    // After untrack, ticks must not re-emit for this session
    const calls: AssistantStatus[] = [];
    observer.onStatusChange(() => calls.push({ kind: 'busy' }));
    now += 10_000;
    vi.advanceTimersByTime(2000);
    expect(calls.length).toBe(0);

    observer.close();
  });

  it('close() tears down all watchers without throwing', async () => {
    const observer = makeObserver();
    observer.track('s', '/home/u/repo');
    expect(() => observer.close()).not.toThrow();
  });

  it('handles malformed JSONL lines gracefully', async () => {
    const sessionId = 's9';
    const cwd = '/home/u/repo';
    ensureSessionDir(cwd);
    appendFileSync(jsonlPath(cwd, sessionId), 'not-json\n');
    writeLine(cwd, sessionId, makeAssistantText(sessionId, 'ok'));

    const observer = makeObserver();
    observer.track(sessionId, cwd);
    await observer.rescan(sessionId);

    expect(observer.snapshot(sessionId)).toEqual({ kind: 'busy' });
    observer.close();
  });

  it('encodes cwd path correctly when locating log file', async () => {
    const sessionId = 's10';
    const cwd = '/home/mku/projects/gustav';
    writeLine(cwd, sessionId, makeAssistantText(sessionId, 'hello'));

    const observer = makeObserver();
    const status = await observer.getStatus(sessionId, cwd);
    expect(status).toEqual({ kind: 'busy' });
    observer.close();
  });

  it('tool_use becomes busy again when its tool_result arrives within 5s', async () => {
    const sessionId = 's11';
    const cwd = '/home/u/repo';
    writeLine(cwd, sessionId, makeAssistantToolUse(sessionId, 'tool-A'));

    const observer = makeObserver();
    observer.track(sessionId, cwd);
    await observer.rescan(sessionId);
    expect(observer.snapshot(sessionId)).toEqual({ kind: 'busy' });

    // Append the tool_result before the 5s action window
    now += 2000;
    writeLine(cwd, sessionId, makeUserToolResult(sessionId, 'tool-A'));
    await observer.rescan(sessionId);
    expect(observer.snapshot(sessionId)).toEqual({ kind: 'busy' });
    observer.close();
  });
});
