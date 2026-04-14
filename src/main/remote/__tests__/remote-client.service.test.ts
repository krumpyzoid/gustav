import { describe, it, expect, vi, afterEach } from 'vitest';
import https from 'node:https';
import { WebSocketServer, WebSocket } from 'ws';
import { RemoteClientService } from '../remote-client.service';
import { generateSelfSignedCert } from '../crypto';
import { encodeControlMessage } from '../protocol';

const BASE_PORT = 19100;
let portOffset = 0;

function nextPort() { return BASE_PORT + portOffset++; }

function createTestServer(port: number) {
  const { cert, key } = generateSelfSignedCert();
  const server = https.createServer({ cert, key });
  const wss = new WebSocketServer({ server });
  return {
    server,
    wss,
    start: () => new Promise<void>((resolve) => server.listen(port, resolve)),
    stop: () => new Promise<void>((resolve) => {
      wss.close();
      server.close(() => resolve());
    }),
  };
}

let testServer: ReturnType<typeof createTestServer> | null = null;
let service: RemoteClientService | null = null;

afterEach(async () => {
  service?.disconnect();
  service = null;
  if (testServer) {
    await testServer.stop();
    testServer = null;
  }
});

describe('RemoteClientService', () => {
  it('connects and receives state updates', async () => {
    const port = nextPort();
    testServer = createTestServer(port);
    await testServer.start();

    // Server auto-sends a state update on connection
    testServer.wss.on('connection', (ws) => {
      ws.send(encodeControlMessage({
        type: 'state-update',
        id: 'state-1',
        payload: { defaultWorkspace: {}, workspaces: [{ id: 'ws1' }], windows: [] },
      }));
    });

    service = new RemoteClientService('/tmp/gustav-test-client');
    let receivedState: any = null;
    service.onStateUpdate((state) => { receivedState = state; });

    await service.connect(`wss://127.0.0.1:${port}`);
    await new Promise((r) => setTimeout(r, 100));

    expect(receivedState).not.toBeNull();
    expect(receivedState.workspaces).toHaveLength(1);
  });

  it('sends commands to the server', async () => {
    const port = nextPort();
    testServer = createTestServer(port);
    await testServer.start();

    let serverReceived: any = null;
    testServer.wss.on('connection', (ws) => {
      ws.on('message', (data) => {
        serverReceived = JSON.parse(data.toString());
      });
    });

    service = new RemoteClientService('/tmp/gustav-test-client');
    await service.connect(`wss://127.0.0.1:${port}`);

    service.sendCommand('sleep-session', { session: 'ws/repo/_dir' });
    await new Promise((r) => setTimeout(r, 100));

    expect(serverReceived).not.toBeNull();
    expect(serverReceived.type).toBe('session-command');
    expect(serverReceived.payload.action).toBe('sleep-session');
  });

  it('reports connection status', async () => {
    const port = nextPort();
    testServer = createTestServer(port);
    await testServer.start();

    service = new RemoteClientService('/tmp/gustav-test-client');
    expect(service.getConnectionStatus()).toBe('disconnected');

    await service.connect(`wss://127.0.0.1:${port}`);
    expect(service.getConnectionStatus()).toBe('connected');

    service.disconnect();
    expect(service.getConnectionStatus()).toBe('disconnected');
  });

  it('handles PTY binary data via callback', async () => {
    const port = nextPort();
    testServer = createTestServer(port);
    await testServer.start();

    testServer.wss.on('connection', (ws) => {
      // Send a binary PTY data frame
      const frame = Buffer.alloc(10);
      frame.writeUInt8(0x01, 0); // PTY_DATA
      frame.writeUInt32BE(1, 1); // channel ID
      Buffer.from('hello').copy(frame, 5);
      ws.send(frame);
    });

    service = new RemoteClientService('/tmp/gustav-test-client');
    let receivedPty: Buffer | null = null;
    service.onPtyData((data) => { receivedPty = data; });

    await service.connect(`wss://127.0.0.1:${port}`);
    await new Promise((r) => setTimeout(r, 100));

    expect(receivedPty).not.toBeNull();
  });
});
