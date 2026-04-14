import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { RemoteServerAdapter } from '../remote-server.adapter';
import { generateSelfSignedCert } from '../crypto';

const TEST_PORT = 17777;

function createServer(): RemoteServerAdapter {
  const { cert, key } = generateSelfSignedCert();
  return new RemoteServerAdapter({ port: TEST_PORT, cert, key });
}

function connectClient(port = TEST_PORT): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`wss://127.0.0.1:${port}`, { rejectUnauthorized: false });
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

let server: RemoteServerAdapter | null = null;

afterEach(async () => {
  if (server) {
    await server.stop();
    server = null;
  }
});

describe('RemoteServerAdapter', () => {
  it('starts and stops on a given port', async () => {
    server = createServer();
    await server.start();

    const ws = await connectClient();
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });

  it('accepts a WebSocket connection and emits onConnection', async () => {
    server = createServer();
    let connectionReceived = false;
    server.onConnection(() => { connectionReceived = true; });
    await server.start();

    const ws = await connectClient();
    // Give event loop a tick
    await new Promise((r) => setTimeout(r, 50));
    expect(connectionReceived).toBe(true);
    ws.close();
  });

  it('emits onDisconnection when client closes', async () => {
    server = createServer();
    let disconnected = false;
    server.onDisconnection(() => { disconnected = true; });
    await server.start();

    const ws = await connectClient();
    await new Promise((r) => setTimeout(r, 50));
    ws.close();
    await new Promise((r) => setTimeout(r, 50));
    expect(disconnected).toBe(true);
  });

  it('rejects a second client while one is connected', async () => {
    server = createServer();
    await server.start();

    const ws1 = await connectClient();
    await new Promise((r) => setTimeout(r, 50));

    // Second client should be rejected
    const ws2Error = await new Promise<string>((resolve) => {
      const ws2 = new WebSocket(`wss://127.0.0.1:${TEST_PORT}`, { rejectUnauthorized: false });
      ws2.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'error') {
          resolve(msg.payload.message);
          ws2.close();
        }
      });
      ws2.on('error', () => resolve('connection error'));
    });

    expect(ws2Error).toContain('already connected');

    ws1.close();
  });

  it('allows a new client after the previous one disconnects', async () => {
    server = createServer();
    let connectionCount = 0;
    server.onConnection(() => { connectionCount++; });
    await server.start();

    const ws1 = await connectClient();
    await new Promise((r) => setTimeout(r, 50));
    ws1.close();
    await new Promise((r) => setTimeout(r, 50));

    const ws2 = await connectClient();
    await new Promise((r) => setTimeout(r, 50));
    expect(connectionCount).toBe(2);
    ws2.close();
  });

  it('forwards text messages to onMessage handler', async () => {
    server = createServer();
    let received: string | null = null;
    server.onMessage((data) => { received = data as string; });
    await server.start();

    const ws = await connectClient();
    await new Promise((r) => setTimeout(r, 50));
    ws.send(JSON.stringify({ type: 'auth', id: '1', payload: {} }));
    await new Promise((r) => setTimeout(r, 50));

    expect(received).toContain('"auth"');
    ws.close();
  });

  it('forwards binary messages to onBinaryMessage handler', async () => {
    server = createServer();
    let received: Buffer | null = null;
    server.onBinaryMessage((data) => { received = data; });
    await server.start();

    const ws = await connectClient();
    await new Promise((r) => setTimeout(r, 50));
    const binary = Buffer.from([0x01, 0x00, 0x00, 0x00, 0x01, 0x48, 0x49]);
    ws.send(binary);
    await new Promise((r) => setTimeout(r, 50));

    expect(received).not.toBeNull();
    expect(Buffer.compare(received!, binary)).toBe(0);
    ws.close();
  });

  it('can send text to the connected client', async () => {
    server = createServer();
    await server.start();

    const ws = await connectClient();
    await new Promise((r) => setTimeout(r, 50));

    const msgPromise = new Promise<string>((resolve) => {
      ws.on('message', (data) => resolve(data.toString()));
    });

    server.sendText('hello from server');
    const msg = await msgPromise;
    expect(msg).toBe('hello from server');
    ws.close();
  });

  it('can send binary to the connected client', async () => {
    server = createServer();
    await server.start();

    const ws = await connectClient();
    await new Promise((r) => setTimeout(r, 50));

    const msgPromise = new Promise<Buffer>((resolve) => {
      ws.on('message', (data) => resolve(data as Buffer));
    });

    const binary = Buffer.from([0x01, 0x02, 0x03]);
    server.sendBinary(binary);
    const msg = await msgPromise;
    expect(Buffer.compare(msg, binary)).toBe(0);
    ws.close();
  });

  it('rate-limits by tracking failed auth attempts', async () => {
    server = createServer();
    await server.start();

    // Record 5 failed attempts rapidly
    for (let i = 0; i < 5; i++) {
      server.recordFailedAuth('127.0.0.1');
    }

    expect(server.isRateLimited('127.0.0.1')).toBe(true);
  });

  it('does not rate-limit under the threshold', async () => {
    server = createServer();
    await server.start();

    for (let i = 0; i < 4; i++) {
      server.recordFailedAuth('127.0.0.1');
    }

    expect(server.isRateLimited('127.0.0.1')).toBe(false);
  });

  it('reports hasClient correctly', async () => {
    server = createServer();
    await server.start();
    expect(server.hasClient()).toBe(false);

    const ws = await connectClient();
    await new Promise((r) => setTimeout(r, 50));
    expect(server.hasClient()).toBe(true);

    ws.close();
    await new Promise((r) => setTimeout(r, 50));
    expect(server.hasClient()).toBe(false);
  });

  it('can disconnect the current client', async () => {
    server = createServer();
    let disconnected = false;
    server.onDisconnection(() => { disconnected = true; });
    await server.start();

    const ws = await connectClient();
    await new Promise((r) => setTimeout(r, 50));

    server.disconnectClient();
    await new Promise((r) => setTimeout(r, 50));

    expect(disconnected).toBe(true);
    expect(server.hasClient()).toBe(false);
  });
});
