import { describe, it, expect } from 'vitest';
import {
  ChannelType,
  encodeBinaryFrame,
  decodeBinaryFrame,
  encodeControlMessage,
  decodeControlMessage,
  type ControlMessage,
  type BinaryFrame,
} from '../protocol';

describe('Binary frame encoding/decoding', () => {
  it('encodes and decodes a PTY data frame', () => {
    const payload = Buffer.from('hello terminal');
    const frame: BinaryFrame = { channelType: ChannelType.PTY_DATA, channelId: 42, payload };

    const encoded = encodeBinaryFrame(frame);
    expect(encoded).toBeInstanceOf(Buffer);
    expect(encoded.length).toBe(1 + 4 + payload.length);

    const decoded = decodeBinaryFrame(encoded);
    expect(decoded.channelType).toBe(ChannelType.PTY_DATA);
    expect(decoded.channelId).toBe(42);
    expect(decoded.payload.toString()).toBe('hello terminal');
  });

  it('encodes and decodes a PTY input frame', () => {
    const payload = Buffer.from('ls -la\n');
    const frame: BinaryFrame = { channelType: ChannelType.PTY_INPUT, channelId: 1, payload };

    const encoded = encodeBinaryFrame(frame);
    const decoded = decodeBinaryFrame(encoded);

    expect(decoded.channelType).toBe(ChannelType.PTY_INPUT);
    expect(decoded.channelId).toBe(1);
    expect(decoded.payload.toString()).toBe('ls -la\n');
  });

  it('encodes and decodes a port tunnel frame', () => {
    const payload = Buffer.from([0x48, 0x54, 0x54, 0x50]); // "HTTP"
    const frame: BinaryFrame = { channelType: ChannelType.PORT_TUNNEL, channelId: 5173, payload };

    const encoded = encodeBinaryFrame(frame);
    const decoded = decodeBinaryFrame(encoded);

    expect(decoded.channelType).toBe(ChannelType.PORT_TUNNEL);
    expect(decoded.channelId).toBe(5173);
    expect(Buffer.from(decoded.payload)).toEqual(payload);
  });

  it('handles empty payload', () => {
    const frame: BinaryFrame = { channelType: ChannelType.PTY_DATA, channelId: 0, payload: Buffer.alloc(0) };

    const encoded = encodeBinaryFrame(frame);
    expect(encoded.length).toBe(5); // 1 + 4 + 0

    const decoded = decodeBinaryFrame(encoded);
    expect(decoded.payload.length).toBe(0);
  });

  it('handles large channel IDs (up to 2^32 - 1)', () => {
    const frame: BinaryFrame = { channelType: ChannelType.PORT_TUNNEL, channelId: 0xFFFFFFFF, payload: Buffer.from('x') };

    const encoded = encodeBinaryFrame(frame);
    const decoded = decodeBinaryFrame(encoded);

    expect(decoded.channelId).toBe(0xFFFFFFFF);
  });

  it('throws on buffer too short to decode', () => {
    expect(() => decodeBinaryFrame(Buffer.alloc(3))).toThrow();
  });
});

describe('Control message encoding/decoding', () => {
  it('encodes and decodes a state-update message', () => {
    const msg: ControlMessage = {
      type: 'state-update',
      id: 'abc-123',
      payload: { workspaces: [] },
    };

    const encoded = encodeControlMessage(msg);
    expect(typeof encoded).toBe('string');

    const decoded = decodeControlMessage(encoded);
    expect(decoded.type).toBe('state-update');
    expect(decoded.id).toBe('abc-123');
    expect(decoded.payload).toEqual({ workspaces: [] });
  });

  it('encodes and decodes a session-command message', () => {
    const msg: ControlMessage = {
      type: 'session-command',
      id: 'def-456',
      payload: { action: 'switch', tmuxSession: 'myws/repo/main' },
    };

    const encoded = encodeControlMessage(msg);
    const decoded = decodeControlMessage(encoded);

    expect(decoded.type).toBe('session-command');
    expect(decoded.payload.action).toBe('switch');
  });

  it('encodes and decodes an auth message', () => {
    const msg: ControlMessage = {
      type: 'auth',
      id: 'ghi-789',
      payload: { method: 'pair', code: 'ABC123' },
    };

    const encoded = encodeControlMessage(msg);
    const decoded = decodeControlMessage(encoded);

    expect(decoded.type).toBe('auth');
    expect(decoded.payload.code).toBe('ABC123');
  });

  it('encodes and decodes an error message', () => {
    const msg: ControlMessage = {
      type: 'error',
      id: 'err-1',
      payload: { message: 'Something went wrong' },
    };

    const encoded = encodeControlMessage(msg);
    const decoded = decodeControlMessage(encoded);

    expect(decoded.type).toBe('error');
    expect(decoded.payload.message).toBe('Something went wrong');
  });

  it('encodes and decodes a port-event message', () => {
    const msg: ControlMessage = {
      type: 'port-event',
      id: 'port-1',
      payload: { action: 'detected', port: 5173, session: 'ws/repo/main' },
    };

    const encoded = encodeControlMessage(msg);
    const decoded = decodeControlMessage(encoded);

    expect(decoded.type).toBe('port-event');
    expect(decoded.payload.port).toBe(5173);
  });

  it('throws on invalid JSON', () => {
    expect(() => decodeControlMessage('not json')).toThrow();
  });

  it('throws on missing type field', () => {
    expect(() => decodeControlMessage(JSON.stringify({ id: '1', payload: {} }))).toThrow();
  });
});
