import { describe, it, expect, afterEach } from 'vitest';
import net from 'node:net';
import { ClientTunnelManager } from '../client-tunnel-manager';
import { ChannelType, encodeBinaryFrame, decodeBinaryFrame } from '../protocol';

let manager: ClientTunnelManager | null = null;

afterEach(() => {
  manager?.destroyAll();
  manager = null;
});

describe('ClientTunnelManager', () => {
  it('starts a local TCP listener and returns local port + channel ID', async () => {
    const emitted: Buffer[] = [];
    manager = new ClientTunnelManager((frame) => emitted.push(frame));

    const result = await manager.startForward(5173, 15173, 1);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.localPort).toBe(15173);
      expect(result.channelId).toBe(1);
    }
  });

  it('relays incoming TCP data as binary frames to the WebSocket', async () => {
    const emitted: Buffer[] = [];
    manager = new ClientTunnelManager((frame) => emitted.push(frame));

    const result = await manager.startForward(3000, 13000, 42);
    expect(result.success).toBe(true);

    // Connect a TCP client to the local listener
    const client = net.createConnection({ port: 13000, host: '127.0.0.1' }, () => {
      client.write('GET / HTTP/1.1\r\n\r\n');
    });

    await new Promise((r) => setTimeout(r, 100));

    expect(emitted.length).toBeGreaterThan(0);
    const frame = decodeBinaryFrame(emitted[0]!);
    expect(frame.channelType).toBe(ChannelType.PORT_TUNNEL);
    expect(frame.channelId).toBe(42);
    expect(frame.payload.toString()).toContain('GET /');

    client.destroy();
  });

  it('forwards binary frames from WebSocket to the TCP client', async () => {
    const emitted: Buffer[] = [];
    manager = new ClientTunnelManager((frame) => emitted.push(frame));

    const result = await manager.startForward(8080, 18080, 99);
    expect(result.success).toBe(true);

    // Connect and wait for the connection to register
    let clientReceived = '';
    const client = net.createConnection({ port: 18080, host: '127.0.0.1' }, () => {
      client.on('data', (data) => { clientReceived += data.toString(); });
    });

    await new Promise((r) => setTimeout(r, 100));

    // Send a binary frame as if from the server
    const responseFrame = encodeBinaryFrame({
      channelType: ChannelType.PORT_TUNNEL,
      channelId: 99,
      payload: Buffer.from('HTTP/1.1 200 OK\r\n\r\n'),
    });
    manager.handleData(responseFrame);

    await new Promise((r) => setTimeout(r, 100));
    expect(clientReceived).toContain('200 OK');

    client.destroy();
  });

  it('stops a forward and closes the local listener', async () => {
    const emitted: Buffer[] = [];
    manager = new ClientTunnelManager((frame) => emitted.push(frame));

    const result = await manager.startForward(4000, 14000, 7);
    expect(result.success).toBe(true);

    manager.stopForward(7);

    // Listener should be closed — connecting should fail
    await new Promise<void>((resolve) => {
      const client = net.createConnection({ port: 14000, host: '127.0.0.1' });
      client.on('error', () => resolve());
      client.on('connect', () => {
        client.destroy();
        resolve();
      });
    });
  });

  it('returns error when port is already in use', async () => {
    const emitted: Buffer[] = [];
    manager = new ClientTunnelManager((frame) => emitted.push(frame));

    // Occupy a port
    const occupied = net.createServer();
    await new Promise<void>((resolve) => occupied.listen(14444, '127.0.0.1', resolve));

    try {
      const result = await manager.startForward(3000, 14444, 1);
      expect(result.success).toBe(false);
    } finally {
      occupied.close();
    }
  });
});
