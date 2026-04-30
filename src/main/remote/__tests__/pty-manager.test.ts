import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PtyManager } from '../pty-manager';
import { ChannelType, decodeBinaryFrame, encodeBinaryFrame } from '../protocol';

// Mock node-pty since we can't spawn real tmux in tests
const mockPtyWrite = vi.fn();
const mockPtyResize = vi.fn();
const mockPtyKill = vi.fn();
const mockPtyOnData = vi.fn();
const mockPtyOnExit = vi.fn();

vi.mock('node-pty', () => ({
  default: {
    spawn: vi.fn(() => ({
      pid: 12345,
      write: mockPtyWrite,
      resize: mockPtyResize,
      kill: mockPtyKill,
      onData: mockPtyOnData,
      onExit: mockPtyOnExit,
    })),
  },
}));

describe('PtyManager', () => {
  let manager: PtyManager;
  let emittedFrames: Buffer[];

  beforeEach(() => {
    vi.clearAllMocks();
    emittedFrames = [];
    manager = new PtyManager((frame) => { emittedFrames.push(frame); });
  });

  it('attaches to a tmux session and returns a channel ID', () => {
    const channelId = manager.attach('ws/repo/main', 80, 24);
    expect(typeof channelId).toBe('number');
    expect(channelId).toBeGreaterThan(0);
  });

  it('emits binary frames when PTY produces data', () => {
    const channelId = manager.attach('ws/repo/main', 80, 24);

    // Simulate PTY onData callback
    const dataCallback = mockPtyOnData.mock.calls[0]![0] as (data: string) => void;
    dataCallback('hello from terminal');

    expect(emittedFrames.length).toBe(1);
    const frame = decodeBinaryFrame(emittedFrames[0]!);
    expect(frame.channelType).toBe(ChannelType.PTY_DATA);
    expect(frame.channelId).toBe(channelId);
    expect(frame.payload.toString()).toBe('hello from terminal');
  });

  it('writes input to PTY when receiving input frames', () => {
    const channelId = manager.attach('ws/repo/main', 80, 24);

    const inputFrame = encodeBinaryFrame({
      channelType: ChannelType.PTY_INPUT,
      channelId,
      payload: Buffer.from('ls -la\n'),
    });

    manager.handleInput(inputFrame);
    expect(mockPtyWrite).toHaveBeenCalledWith('ls -la\n');
  });

  it('resizes the PTY', () => {
    const channelId = manager.attach('ws/repo/main', 80, 24);
    manager.resize(channelId, 120, 40);
    expect(mockPtyResize).toHaveBeenCalledWith(120, 40);
  });

  it('detaches and kills the PTY process', () => {
    const channelId = manager.attach('ws/repo/main', 80, 24);
    manager.detach(channelId);
    expect(mockPtyKill).toHaveBeenCalled();
    expect(manager.isAttached(channelId)).toBe(false);
  });

  it('supports multiple simultaneous attachments', () => {
    const id1 = manager.attach('ws/repo/main', 80, 24);
    const id2 = manager.attach('ws/repo/feat', 80, 24);
    expect(id1).not.toBe(id2);
    expect(manager.isAttached(id1)).toBe(true);
    expect(manager.isAttached(id2)).toBe(true);
  });

  it('detaches all sessions on destroyAll', () => {
    manager.attach('ws/repo/main', 80, 24);
    manager.attach('ws/repo/feat', 80, 24);
    manager.destroyAll();
    expect(mockPtyKill).toHaveBeenCalledTimes(2);
  });

  it('ignores input for unknown channel IDs', () => {
    const inputFrame = encodeBinaryFrame({
      channelType: ChannelType.PTY_INPUT,
      channelId: 99999,
      payload: Buffer.from('ignored'),
    });
    manager.handleInput(inputFrame);
    expect(mockPtyWrite).not.toHaveBeenCalled();
  });

  describe('supervisor (native) attach path', () => {
    type DataListener = (sessionId: string, windowId: string, data: string) => void;

    function makeSupervisor() {
      const dataListeners = new Set<DataListener>();
      const supervisor = {
        attachClient: vi.fn(),
        detachClient: vi.fn(),
        resizeClient: vi.fn(),
        sendInput: vi.fn(),
        onWindowData: vi.fn((l: DataListener) => {
          dataListeners.add(l);
          return () => dataListeners.delete(l);
        }),
      };
      const emit = (sessionId: string, windowId: string, data: string) => {
        for (const l of dataListeners) l(sessionId, windowId, data);
      };
      return { supervisor, emit, dataListeners };
    }

    it('attachSupervisor returns a unique channel id and registers a client', () => {
      const { supervisor } = makeSupervisor();
      const m = new PtyManager((f) => emittedFrames.push(f), supervisor as any);

      const channelId = m.attachSupervisor('ws/repo/_dir', 80, 24);

      expect(typeof channelId).toBe('number');
      expect(channelId).toBeGreaterThan(0);
      expect(supervisor.attachClient).toHaveBeenCalledWith(expect.objectContaining({
        sessionId: 'ws/repo/_dir',
        cols: 80,
        rows: 24,
      }));
    });

    it('emits binary frames for the channel when supervisor produces window data', () => {
      const { supervisor, emit } = makeSupervisor();
      const m = new PtyManager((f) => emittedFrames.push(f), supervisor as any);
      const channelId = m.attachSupervisor('ws/repo/_dir', 80, 24);

      emit('ws/repo/_dir', 'w1', 'hello supervisor');

      expect(emittedFrames.length).toBe(1);
      const frame = decodeBinaryFrame(emittedFrames[0]!);
      expect(frame.channelType).toBe(ChannelType.PTY_DATA);
      expect(frame.channelId).toBe(channelId);
      expect(frame.payload.toString()).toBe('hello supervisor');
    });

    it('does NOT emit frames for data from a different supervisor session', () => {
      const { supervisor, emit } = makeSupervisor();
      const m = new PtyManager((f) => emittedFrames.push(f), supervisor as any);
      m.attachSupervisor('ws/repo/_dir', 80, 24);

      emit('other/session', 'w1', 'should be ignored');

      expect(emittedFrames.length).toBe(0);
    });

    it('routes input frames into supervisor.sendInput for native channels', () => {
      const { supervisor } = makeSupervisor();
      const m = new PtyManager((f) => emittedFrames.push(f), supervisor as any);
      const channelId = m.attachSupervisor('ws/repo/_dir', 80, 24);

      m.handleInput(encodeBinaryFrame({
        channelType: ChannelType.PTY_INPUT,
        channelId,
        payload: Buffer.from('echo hi\n'),
      }));

      expect(supervisor.sendInput).toHaveBeenCalledWith('ws/repo/_dir', 'echo hi\n');
      expect(mockPtyWrite).not.toHaveBeenCalled();
    });

    it('resize forwards to supervisor.resizeClient for native channels', () => {
      const { supervisor } = makeSupervisor();
      const m = new PtyManager((f) => emittedFrames.push(f), supervisor as any);
      const channelId = m.attachSupervisor('ws/repo/_dir', 80, 24);

      m.resize(channelId, 132, 50);

      expect(supervisor.resizeClient).toHaveBeenCalledWith(
        'ws/repo/_dir',
        expect.any(String),
        132,
        50,
      );
    });

    it('detach calls supervisor.detachClient and stops emitting frames', () => {
      const { supervisor, emit, dataListeners } = makeSupervisor();
      const m = new PtyManager((f) => emittedFrames.push(f), supervisor as any);
      const channelId = m.attachSupervisor('ws/repo/_dir', 80, 24);

      m.detach(channelId);

      expect(supervisor.detachClient).toHaveBeenCalledWith('ws/repo/_dir', expect.any(String));
      expect(m.isAttached(channelId)).toBe(false);
      // Listener should be released — emitting now produces no frames.
      emit('ws/repo/_dir', 'w1', 'after-detach');
      expect(emittedFrames.length).toBe(0);
      expect(dataListeners.size).toBe(0);
    });

    it('attachSupervisor returns the existing channel id when called twice for the same session', () => {
      const { supervisor, dataListeners } = makeSupervisor();
      const m = new PtyManager((f) => emittedFrames.push(f), supervisor as any);

      const id1 = m.attachSupervisor('ws/repo/_dir', 80, 24);
      const id2 = m.attachSupervisor('ws/repo/_dir', 80, 24);

      expect(id2).toBe(id1);
      // Only ONE listener registered — duplicate-attach guard prevents leak.
      expect(dataListeners.size).toBe(1);
    });

    it('attachSupervisor without a configured supervisor throws', () => {
      const m = new PtyManager((f) => emittedFrames.push(f));
      expect(() => m.attachSupervisor('ws/repo/_dir', 80, 24)).toThrow(/supervisor not configured/);
    });

    it('destroyAll detaches both tmux and supervisor channels', () => {
      const { supervisor } = makeSupervisor();
      const m = new PtyManager((f) => emittedFrames.push(f), supervisor as any);
      m.attach('ws/repo/main', 80, 24);
      m.attachSupervisor('ws/repo/_dir', 80, 24);

      m.destroyAll();

      expect(mockPtyKill).toHaveBeenCalled();
      expect(supervisor.detachClient).toHaveBeenCalled();
    });
  });
});
