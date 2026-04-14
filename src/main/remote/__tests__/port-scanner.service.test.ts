import { describe, it, expect } from 'vitest';
import { parsePortsFromOutput, parseSsOutput, type DetectedPort } from '../port-scanner.service';

describe('parsePortsFromOutput', () => {
  it('detects localhost:PORT pattern', () => {
    const ports = parsePortsFromOutput('Server running at http://localhost:3000');
    expect(ports).toContain(3000);
  });

  it('detects 127.0.0.1:PORT pattern', () => {
    const ports = parsePortsFromOutput('Listening on 127.0.0.1:8080');
    expect(ports).toContain(8080);
  });

  it('detects 0.0.0.0:PORT pattern', () => {
    const ports = parsePortsFromOutput('  ➜  Local:   http://0.0.0.0:5173/');
    expect(ports).toContain(5173);
  });

  it('detects Vite-style output', () => {
    const output = `  VITE v5.0.0  ready in 200ms

  ➜  Local:   http://localhost:5173/
  ➜  Network: http://192.168.1.10:5173/`;
    const ports = parsePortsFromOutput(output);
    expect(ports).toContain(5173);
  });

  it('detects Next.js-style output', () => {
    const ports = parsePortsFromOutput('  ▲ Next.js 14.0.0\n  - Local: http://localhost:3000');
    expect(ports).toContain(3000);
  });

  it('detects "port NNNN" pattern', () => {
    const ports = parsePortsFromOutput('Express server listening on port 4000');
    expect(ports).toContain(4000);
  });

  it('detects "listening on NNNN" pattern', () => {
    const ports = parsePortsFromOutput('Server listening on 9090');
    expect(ports).toContain(9090);
  });

  it('returns empty array for no matches', () => {
    const ports = parsePortsFromOutput('Hello world');
    expect(ports).toEqual([]);
  });

  it('deduplicates ports', () => {
    const ports = parsePortsFromOutput('http://localhost:3000 and http://0.0.0.0:3000');
    expect(ports).toEqual([3000]);
  });

  it('ignores common non-port numbers', () => {
    const ports = parsePortsFromOutput('version 14.0.0');
    expect(ports).toEqual([]);
  });
});

describe('parseSsOutput', () => {
  it('parses ss -tlnp output into port/PID pairs', () => {
    const ssOutput = `State    Recv-Q   Send-Q     Local Address:Port      Peer Address:Port   Process
LISTEN   0        128              0.0.0.0:22             0.0.0.0:*       users:(("sshd",pid=1234,fd=3))
LISTEN   0        511              0.0.0.0:3000           0.0.0.0:*       users:(("node",pid=5678,fd=18))
LISTEN   0        511            127.0.0.1:5173           0.0.0.0:*       users:(("node",pid=9012,fd=22))`;

    const results = parseSsOutput(ssOutput);
    expect(results).toEqual([
      { port: 22, pid: 1234 },
      { port: 3000, pid: 5678 },
      { port: 5173, pid: 9012 },
    ]);
  });

  it('handles empty output', () => {
    const results = parseSsOutput('');
    expect(results).toEqual([]);
  });

  it('handles output with no process info', () => {
    const ssOutput = `State    Recv-Q   Send-Q     Local Address:Port      Peer Address:Port
LISTEN   0        128              0.0.0.0:22             0.0.0.0:*`;

    const results = parseSsOutput(ssOutput);
    expect(results).toEqual([{ port: 22, pid: null }]);
  });

  it('handles IPv6 addresses', () => {
    const ssOutput = `LISTEN   0   128   [::]:8080   [::]:*   users:(("node",pid=1111,fd=3))`;
    const results = parseSsOutput(ssOutput);
    expect(results).toEqual([{ port: 8080, pid: 1111 }]);
  });
});
