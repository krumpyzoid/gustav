import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { TunnelManager } from '../tunnel-manager';
import { ChannelType, encodeBinaryFrame, decodeBinaryFrame } from '../protocol';
import net from 'node:net';

// Suppress ECONNRESET from socket teardown in tests
function suppressConnReset(err: NodeJS.ErrnoException) {
  if (err.code === 'ECONNRESET') return;
  throw err;
}
process.on('uncaughtException', suppressConnReset);
afterAll(() => { process.removeListener('uncaughtException', suppressConnReset); });

describe('TunnelManager', () => {
  let manager: TunnelManager;
  let emittedFrames: Buffer[];

  beforeEach(() => {
    emittedFrames = [];
    manager = new TunnelManager((frame) => { emittedFrames.push(frame); });
  });

  it('creates a tunnel and assigns a unique channel ID', async () => {
    // Start a local TCP server to connect to
    const server = net.createServer((socket) => {
      socket.write('hello');
      socket.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as net.AddressInfo).port;

    try {
      const result = await manager.createTunnel(port);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.channelId).toBeGreaterThan(0);
      }
    } finally {
      manager.destroyAll();
      server.close();
    }
  });

  it('relays data from target port as binary frames', async () => {
    const server = net.createServer((socket) => {
      socket.on('error', () => {}); // Suppress ECONNRESET
      socket.write('response data');
      socket.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as net.AddressInfo).port;

    try {
      const result = await manager.createTunnel(port);
      expect(result.success).toBe(true);

      // Wait for data to flow
      await new Promise((r) => setTimeout(r, 100));

      expect(emittedFrames.length).toBeGreaterThan(0);
      const frame = decodeBinaryFrame(emittedFrames[0]!);
      expect(frame.channelType).toBe(ChannelType.PORT_TUNNEL);
      expect(frame.payload.toString()).toContain('response data');
    } finally {
      manager.destroyAll();
      server.close();
    }
  });

  it('forwards incoming binary frames to the target port', async () => {
    let received = '';
    const server = net.createServer((socket) => {
      socket.on('data', (data) => { received += data.toString(); });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as net.AddressInfo).port;

    try {
      const result = await manager.createTunnel(port);
      expect(result.success).toBe(true);
      if (!result.success) return;

      const frame = encodeBinaryFrame({
        channelType: ChannelType.PORT_TUNNEL,
        channelId: result.channelId,
        payload: Buffer.from('hello from client'),
      });

      manager.handleData(frame);
      await new Promise((r) => setTimeout(r, 100));

      expect(received).toBe('hello from client');
    } finally {
      manager.destroyAll();
      server.close();
    }
  });

  it('destroys a specific tunnel', async () => {
    const server = net.createServer(() => {});
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as net.AddressInfo).port;

    try {
      const result = await manager.createTunnel(port);
      expect(result.success).toBe(true);
      if (!result.success) return;

      manager.destroyTunnel(result.channelId);
      expect(manager.isActive(result.channelId)).toBe(false);
    } finally {
      server.close();
    }
  });

  it('returns error when target port is not listening', async () => {
    // Use a port that's almost certainly not listening
    const result = await manager.createTunnel(19999);
    expect(result.success).toBe(false);
  });

  it('ignores data for unknown channel IDs', () => {
    const frame = encodeBinaryFrame({
      channelType: ChannelType.PORT_TUNNEL,
      channelId: 99999,
      payload: Buffer.from('ignored'),
    });
    // Should not throw
    manager.handleData(frame);
  });
});
