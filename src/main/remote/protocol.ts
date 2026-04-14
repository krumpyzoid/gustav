// ── Channel types for binary frame multiplexing ──────────────────────
export const ChannelType = {
  PTY_DATA: 0x01,    // Server → Client: PTY output
  PTY_INPUT: 0x02,   // Client → Server: PTY input (keystrokes)
  PORT_TUNNEL: 0x03, // Bidirectional: port tunnel data
} as const;

export type ChannelTypeValue = (typeof ChannelType)[keyof typeof ChannelType];

// ── Binary frame: [1 byte channel type][4 bytes channel ID][N bytes payload] ─
export type BinaryFrame = {
  channelType: ChannelTypeValue;
  channelId: number;
  payload: Buffer;
};

const HEADER_SIZE = 5; // 1 + 4

export function encodeBinaryFrame(frame: BinaryFrame): Buffer {
  const buf = Buffer.allocUnsafe(HEADER_SIZE + frame.payload.length);
  buf.writeUInt8(frame.channelType, 0);
  buf.writeUInt32BE(frame.channelId, 1);
  frame.payload.copy(buf, HEADER_SIZE);
  return buf;
}

export function decodeBinaryFrame(data: Buffer): BinaryFrame {
  if (data.length < HEADER_SIZE) {
    throw new Error(`Binary frame too short: expected at least ${HEADER_SIZE} bytes, got ${data.length}`);
  }
  return {
    channelType: data.readUInt8(0) as ChannelTypeValue,
    channelId: data.readUInt32BE(1),
    payload: data.subarray(HEADER_SIZE),
  };
}

// ── Control messages (JSON text frames) ──────────────────────────────
export type ControlMessageType = 'state-update' | 'session-command' | 'port-event' | 'auth' | 'error';

export type ControlMessage = {
  type: ControlMessageType;
  id: string;
  payload: Record<string, unknown>;
};

export function encodeControlMessage(msg: ControlMessage): string {
  return JSON.stringify(msg);
}

export function decodeControlMessage(data: string): ControlMessage {
  const parsed = JSON.parse(data);
  if (!parsed.type || typeof parsed.type !== 'string') {
    throw new Error('Control message missing "type" field');
  }
  return parsed as ControlMessage;
}
