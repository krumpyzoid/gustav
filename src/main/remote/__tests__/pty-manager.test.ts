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
});
