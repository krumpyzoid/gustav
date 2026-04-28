import { describe, it, expect, beforeEach } from 'vitest';
import { NativeSupervisor } from '../native-supervisor';
import { createFakePtyFactory, type FakePtyFactory } from './fake-pty';
import type { WindowSpec } from '../../domain/types';

const SHELL = 'bash';

function specs(...names: string[]): WindowSpec[] {
  return names.map((name) => ({ name, kind: 'command', command: 'bash' }));
}

describe('NativeSupervisor', () => {
  let factory: FakePtyFactory;
  let supervisor: NativeSupervisor;

  beforeEach(() => {
    factory = createFakePtyFactory();
    supervisor = new NativeSupervisor({ ptyFactory: factory, defaultShell: SHELL });
  });

  describe('createSession', () => {
    it('spawns a PTY for each window in the spec', async () => {
      await supervisor.createSession({
        sessionId: 'ws/repo/main',
        cwd: '/tmp/repo',
        windows: specs('Claude', 'Shell'),
      });

      expect(factory.all).toHaveLength(2);
      expect(factory.all[0].spawnArgs.cwd).toBe('/tmp/repo');
      expect(factory.all[1].spawnArgs.cwd).toBe('/tmp/repo');
      expect(supervisor.hasSession('ws/repo/main')).toBe(true);
      expect(supervisor.listWindows('ws/repo/main')).toHaveLength(2);
    });

    it('marks the first window active', async () => {
      await supervisor.createSession({
        sessionId: 's1',
        cwd: '/tmp',
        windows: specs('one', 'two'),
      });
      const windows = supervisor.listWindows('s1');
      expect(windows[0].name).toBe('one');
      expect(windows[0].state).toBe('running');
    });

    it('uses composeClaudeCommand for claude-kind windows', async () => {
      await supervisor.createSession({
        sessionId: 's1',
        cwd: '/tmp',
        windows: [{ name: 'Claude', kind: 'claude', claudeSessionId: 'abc-123' }],
      });
      const claudePty = factory.all[0];
      // We expect the spawned command line to include `claude --resume abc-123`
      const joined = [claudePty.spawnArgs.command, ...claudePty.spawnArgs.args].join(' ');
      expect(joined).toContain('claude');
      expect(joined).toContain('--resume abc-123');
    });

    it('throws if the session id already exists', async () => {
      await supervisor.createSession({ sessionId: 's1', cwd: '/tmp', windows: specs('a') });
      await expect(
        supervisor.createSession({ sessionId: 's1', cwd: '/tmp', windows: specs('b') }),
      ).rejects.toThrow();
    });
  });

  describe('selectWindow + onWindowData', () => {
    it('routes onWindowData listeners only for the active window', async () => {
      await supervisor.createSession({
        sessionId: 's1',
        cwd: '/tmp',
        windows: specs('one', 'two'),
      });
      const events: Array<{ windowId: string; data: string }> = [];
      supervisor.onWindowData((_session, windowId, data) => {
        events.push({ windowId, data });
      });

      const [pty1, pty2] = factory.all;
      pty1.emit('hello-1');
      pty2.emit('hello-2');

      // Only window 1 (the initial active one) should propagate.
      const oneId = supervisor.listWindows('s1')[0].id;
      const twoId = supervisor.listWindows('s1')[1].id;
      expect(events).toEqual([{ windowId: oneId, data: 'hello-1' }]);

      // Switch to the other window.
      await supervisor.selectWindow('s1', twoId);
      pty2.emit('hello-2-again');
      expect(events.at(-1)).toEqual({ windowId: twoId, data: 'hello-2-again' });
    });

    it('background windows still buffer to scrollback while inactive', async () => {
      await supervisor.createSession({
        sessionId: 's1',
        cwd: '/tmp',
        windows: specs('one', 'two'),
      });
      const [, pty2] = factory.all;
      const twoId = supervisor.listWindows('s1')[1].id;
      pty2.emit('background-output');
      expect(supervisor.getReplay('s1', twoId)).toBe('background-output');
    });
  });

  describe('sleep / wake', () => {
    it('sleep kills all PTYs and marks windows as exited', async () => {
      await supervisor.createSession({
        sessionId: 's1',
        cwd: '/tmp',
        windows: specs('one', 'two'),
      });
      await supervisor.sleepSession('s1');
      expect(factory.all.every((p) => p.killed)).toBe(true);
      expect(supervisor.listWindows('s1').every((w) => w.state === 'exited')).toBe(true);
      expect(supervisor.hasSession('s1')).toBe(true); // session retained, just asleep
    });

    it('wake respawns PTYs from the retained spec', async () => {
      await supervisor.createSession({
        sessionId: 's1',
        cwd: '/tmp',
        windows: specs('one', 'two'),
      });
      await supervisor.sleepSession('s1');
      expect(factory.all).toHaveLength(2);
      await supervisor.wakeSession('s1');
      expect(factory.all).toHaveLength(4);
      expect(supervisor.listWindows('s1').every((w) => w.state === 'running')).toBe(true);
    });

    it('wake re-issues claude --resume from the persisted spec', async () => {
      await supervisor.createSession({
        sessionId: 's1',
        cwd: '/tmp',
        windows: [{ name: 'Claude', kind: 'claude', claudeSessionId: 'sess-xyz' }],
      });
      await supervisor.sleepSession('s1');
      await supervisor.wakeSession('s1');
      const wakePty = factory.all[1];
      const joined = [wakePty.spawnArgs.command, ...wakePty.spawnArgs.args].join(' ');
      expect(joined).toContain('--resume sess-xyz');
    });
  });

  describe('resize: latest-wins', () => {
    it('resize uses the most recent client size as the PTY size', async () => {
      await supervisor.createSession({
        sessionId: 's1',
        cwd: '/tmp',
        windows: specs('one'),
      });
      const pty = factory.all[0];
      const initialResizes = pty.resizes.length;

      supervisor.attachClient({ sessionId: 's1', clientId: 'A', cols: 80, rows: 24 });
      supervisor.attachClient({ sessionId: 's1', clientId: 'B', cols: 200, rows: 60 });

      // B was the most recent attach — its size should win.
      const last = pty.resizes.at(-1);
      expect(last).toEqual({ cols: 200, rows: 60 });

      // Now A resizes — A becomes most recent.
      supervisor.resizeClient('s1', 'A', 100, 30);
      expect(pty.resizes.at(-1)).toEqual({ cols: 100, rows: 30 });

      // Confirm we're not emitting useless resizes.
      expect(pty.resizes.length).toBeGreaterThan(initialResizes);
    });

    it('does not emit a redundant resize if the size has not changed', async () => {
      await supervisor.createSession({
        sessionId: 's1',
        cwd: '/tmp',
        windows: specs('one'),
      });
      const pty = factory.all[0];
      supervisor.attachClient({ sessionId: 's1', clientId: 'A', cols: 80, rows: 24 });
      const after = pty.resizes.length;
      supervisor.resizeClient('s1', 'A', 80, 24);
      expect(pty.resizes.length).toBe(after);
    });

    it('detachClient falls back to the next most-recent client size', async () => {
      await supervisor.createSession({
        sessionId: 's1',
        cwd: '/tmp',
        windows: specs('one'),
      });
      const pty = factory.all[0];
      supervisor.attachClient({ sessionId: 's1', clientId: 'A', cols: 80, rows: 24 });
      supervisor.attachClient({ sessionId: 's1', clientId: 'B', cols: 200, rows: 60 });
      // B wins.
      expect(pty.resizes.at(-1)).toEqual({ cols: 200, rows: 60 });

      supervisor.detachClient('s1', 'B');
      // A is now the only attached client; supervisor should resize to A's size.
      expect(pty.resizes.at(-1)).toEqual({ cols: 80, rows: 24 });
    });
  });

  describe('window lifecycle', () => {
    it('addWindow spawns a fresh PTY for the new window', async () => {
      await supervisor.createSession({
        sessionId: 's1',
        cwd: '/tmp',
        windows: specs('one'),
      });
      const id = await supervisor.addWindow('s1', { name: 'two', kind: 'command', command: 'bash' });
      expect(supervisor.listWindows('s1')).toHaveLength(2);
      expect(factory.all).toHaveLength(2);
      expect(typeof id).toBe('string');
    });

    it('killWindow kills its PTY and removes it from the session', async () => {
      await supervisor.createSession({
        sessionId: 's1',
        cwd: '/tmp',
        windows: specs('one', 'two'),
      });
      const twoId = supervisor.listWindows('s1')[1].id;
      await supervisor.killWindow('s1', twoId);
      expect(factory.all[1].killed).toBe(true);
      expect(supervisor.listWindows('s1')).toHaveLength(1);
    });

    it('killing the active window switches active to a remaining window', async () => {
      await supervisor.createSession({
        sessionId: 's1',
        cwd: '/tmp',
        windows: specs('one', 'two'),
      });
      const oneId = supervisor.listWindows('s1')[0].id;
      const twoId = supervisor.listWindows('s1')[1].id;
      await supervisor.killWindow('s1', oneId);
      // Active should switch to the surviving window.
      const remaining = supervisor.listWindows('s1');
      expect(remaining).toHaveLength(1);
      expect(remaining[0].id).toBe(twoId);
    });
  });

  describe('replay buffer', () => {
    it('getReplay returns buffered bytes', async () => {
      await supervisor.createSession({ sessionId: 's1', cwd: '/tmp', windows: specs('one') });
      const oneId = supervisor.listWindows('s1')[0].id;
      const pty = factory.all[0];
      pty.emit('chunk-1\n');
      pty.emit('chunk-2\n');
      expect(supervisor.getReplay('s1', oneId)).toBe('chunk-1\nchunk-2\n');
    });

    it('respects the 100KB cap by dropping oldest bytes', async () => {
      await supervisor.createSession({ sessionId: 's1', cwd: '/tmp', windows: specs('one') });
      const oneId = supervisor.listWindows('s1')[0].id;
      const pty = factory.all[0];

      const cap = 100 * 1024;
      const huge = 'a'.repeat(cap);
      pty.emit(huge);
      pty.emit('TAIL'); // 4 bytes pushed past the cap

      const replay = supervisor.getReplay('s1', oneId);
      expect(replay.length).toBe(cap);
      expect(replay.endsWith('TAIL')).toBe(true);
    });
  });

  describe('PTY exit', () => {
    it('fires a session state change with the exit code', async () => {
      await supervisor.createSession({ sessionId: 's1', cwd: '/tmp', windows: specs('one') });
      const events: string[] = [];
      supervisor.onSessionStateChange((sid) => events.push(sid));
      const oneId = supervisor.listWindows('s1')[0].id;
      factory.all[0].exit(7);
      expect(events).toContain('s1');
      const win = supervisor.listWindows('s1').find((w) => w.id === oneId)!;
      expect(win.state).toBe('exited');
      expect(win.exitCode).toBe(7);
    });
  });

  describe('killSession', () => {
    it('kills all PTYs and removes the session entry', async () => {
      await supervisor.createSession({
        sessionId: 's1',
        cwd: '/tmp',
        windows: specs('one', 'two'),
      });
      await supervisor.killSession('s1');
      expect(factory.all.every((p) => p.killed)).toBe(true);
      expect(supervisor.hasSession('s1')).toBe(false);
    });
  });

  describe('sendInput', () => {
    it('routes input to the active window only', async () => {
      await supervisor.createSession({
        sessionId: 's1',
        cwd: '/tmp',
        windows: specs('one', 'two'),
      });
      supervisor.sendInput('s1', 'hello');
      expect(factory.all[0].writes).toContain('hello');
      expect(factory.all[1].writes).not.toContain('hello');
    });
  });

  describe('close', () => {
    it('cleans up all PTYs and listeners', async () => {
      await supervisor.createSession({
        sessionId: 's1',
        cwd: '/tmp',
        windows: specs('one'),
      });
      await supervisor.createSession({
        sessionId: 's2',
        cwd: '/tmp',
        windows: specs('one'),
      });
      const stateChanges: string[] = [];
      supervisor.onSessionStateChange((s) => stateChanges.push(s));

      supervisor.close();
      expect(factory.all.every((p) => p.killed)).toBe(true);

      // After close, listeners should have been disconnected: emitting state
      // change isn't possible after close, but creating a new session is also blocked.
      await expect(
        supervisor.createSession({ sessionId: 's3', cwd: '/tmp', windows: specs('one') }),
      ).rejects.toThrow();
    });
  });

  describe('claude observer integration', () => {
    it('calls observer.track when a claude window is spawned', async () => {
      const tracked: Array<{ sessionId: string; cwd: string }> = [];
      const supervisor2 = new NativeSupervisor({
        ptyFactory: factory,
        defaultShell: SHELL,
        assistantLog: {
          track: (sessionId, cwd) => tracked.push({ sessionId, cwd }),
          untrack: () => {},
        },
      });
      await supervisor2.createSession({
        sessionId: 's1',
        cwd: '/tmp/repo',
        windows: [{ name: 'Claude', kind: 'claude', claudeSessionId: 'abc' }],
      });
      expect(tracked).toEqual([{ sessionId: 'abc', cwd: '/tmp/repo' }]);
    });

    it('calls observer.untrack when a claude window is killed', async () => {
      const untracked: string[] = [];
      const supervisor2 = new NativeSupervisor({
        ptyFactory: factory,
        defaultShell: SHELL,
        assistantLog: {
          track: () => {},
          untrack: (sessionId) => untracked.push(sessionId),
        },
      });
      await supervisor2.createSession({
        sessionId: 's1',
        cwd: '/tmp',
        windows: [{ name: 'Claude', kind: 'claude', claudeSessionId: 'abc' }],
      });
      const claudeId = supervisor2.listWindows('s1')[0].id;
      // killWindow on the only window should kill session — but untrack still fires.
      // For a single-window session we expect killSession to fire untrack too.
      await supervisor2.killSession('s1');
      expect(untracked).toContain('abc');
    });
  });
});
