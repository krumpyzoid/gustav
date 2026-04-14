import { describe, it, expect, afterEach } from 'vitest';
import WebSocket, { WebSocketServer } from 'ws';
import https from 'node:https';
import { RemoteClientAdapter } from '../remote-client.adapter';
import { generateSelfSignedCert } from '../crypto';

const TEST_PORT = 18888;

function createTestServer(): { server: https.Server; wss: WebSocketServer; stop: () => Promise<void> } {
  const { cert, key } = generateSelfSignedCert();
  const server = https.createServer({ cert, key });
  const wss = new WebSocketServer({ server });

  return {
    server,
    wss,
    stop: () => new Promise((resolve) => {
      wss.close();
      server.close(() => resolve());
    }),
  };
}

let testServer: ReturnType<typeof createTestServer> | null = null;
let client: RemoteClientAdapter | null = null;

afterEach(async () => {
  if (client) {
    client.disconnect();
    client = null;
  }
  if (testServer) {
    await testServer.stop();
    testServer = null;
  }
});

describe('RemoteClientAdapter', () => {
  it('connects to a WSS server', async () => {
    testServer = createTestServer();
    await new Promise<void>((resolve) => testServer!.server.listen(TEST_PORT, resolve));

    let serverSawConnection = false;
    testServer.wss.on('connection', () => { serverSawConnection = true; });

    client = new RemoteClientAdapter();
    await client.connect(`wss://127.0.0.1:${TEST_PORT}`);

    expect(client.isConnected()).toBe(true);
    // Wait for server to see it
    await new Promise((r) => setTimeout(r, 50));
    expect(serverSawConnection).toBe(true);
  });

  it('emits onConnected callback', async () => {
    testServer = createTestServer();
    await new Promise<void>((resolve) => testServer!.server.listen(TEST_PORT + 1, resolve));

    client = new RemoteClientAdapter();
    let connected = false;
    client.onConnected(() => { connected = true; });

    await client.connect(`wss://127.0.0.1:${TEST_PORT + 1}`);
    expect(connected).toBe(true);
  });

  it('emits onDisconnected callback on close', async () => {
    testServer = createTestServer();
    await new Promise<void>((resolve) => testServer!.server.listen(TEST_PORT + 2, resolve));

    client = new RemoteClientAdapter();
    let disconnected = false;
    client.onDisconnected(() => { disconnected = true; });

    await client.connect(`wss://127.0.0.1:${TEST_PORT + 2}`);
    client.disconnect();
    await new Promise((r) => setTimeout(r, 50));
    expect(disconnected).toBe(true);
  });

  it('receives text messages', async () => {
    testServer = createTestServer();
    await new Promise<void>((resolve) => testServer!.server.listen(TEST_PORT + 3, resolve));

    testServer.wss.on('connection', (ws) => {
      ws.send('hello from server');
    });

    client = new RemoteClientAdapter();
    let received: string | null = null;
    client.onMessage((data) => { received = data; });

    await client.connect(`wss://127.0.0.1:${TEST_PORT + 3}`);
    await new Promise((r) => setTimeout(r, 100));
    expect(received).toBe('hello from server');
  });

  it('receives binary messages', async () => {
    testServer = createTestServer();
    await new Promise<void>((resolve) => testServer!.server.listen(TEST_PORT + 4, resolve));

    const binary = Buffer.from([0x01, 0x02, 0x03]);
    testServer.wss.on('connection', (ws) => {
      ws.send(binary);
    });

    client = new RemoteClientAdapter();
    let received: Buffer | null = null;
    client.onBinaryMessage((data) => { received = data; });

    await client.connect(`wss://127.0.0.1:${TEST_PORT + 4}`);
    await new Promise((r) => setTimeout(r, 100));
    expect(received).not.toBeNull();
    expect(Buffer.compare(received!, binary)).toBe(0);
  });

  it('can send text to the server', async () => {
    testServer = createTestServer();
    await new Promise<void>((resolve) => testServer!.server.listen(TEST_PORT + 5, resolve));

    let serverReceived: string | null = null;
    testServer.wss.on('connection', (ws) => {
      ws.on('message', (data) => { serverReceived = data.toString(); });
    });

    client = new RemoteClientAdapter();
    await client.connect(`wss://127.0.0.1:${TEST_PORT + 5}`);
    client.sendText('hello from client');
    await new Promise((r) => setTimeout(r, 100));
    expect(serverReceived).toBe('hello from client');
  });

  it('can send binary to the server', async () => {
    testServer = createTestServer();
    await new Promise<void>((resolve) => testServer!.server.listen(TEST_PORT + 6, resolve));

    let serverReceived: Buffer | null = null;
    testServer.wss.on('connection', (ws) => {
      ws.on('message', (data: Buffer) => { serverReceived = data; });
    });

    client = new RemoteClientAdapter();
    await client.connect(`wss://127.0.0.1:${TEST_PORT + 6}`);
    const binary = Buffer.from([0x04, 0x05, 0x06]);
    client.sendBinary(binary);
    await new Promise((r) => setTimeout(r, 100));
    expect(serverReceived).not.toBeNull();
    expect(Buffer.compare(serverReceived!, binary)).toBe(0);
  });

  it('reports not connected after disconnect', async () => {
    testServer = createTestServer();
    await new Promise<void>((resolve) => testServer!.server.listen(TEST_PORT + 7, resolve));

    client = new RemoteClientAdapter();
    await client.connect(`wss://127.0.0.1:${TEST_PORT + 7}`);
    expect(client.isConnected()).toBe(true);

    client.disconnect();
    expect(client.isConnected()).toBe(false);
  });
});
