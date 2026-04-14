export type DetectedPort = {
  port: number;
  pid: number | null;
  session?: string;
  source: 'output' | 'ss';
};

// ── Parse ports from tmux pane output ────────────────────────────────
const PORT_PATTERNS = [
  /(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d{2,5})/g,
  /\bport\s+(\d{2,5})\b/gi,
  /\blistening\s+on\s+(\d{2,5})\b/gi,
];

export function parsePortsFromOutput(output: string): number[] {
  const found = new Set<number>();

  for (const pattern of PORT_PATTERNS) {
    // Reset lastIndex for global regexes
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(output)) !== null) {
      const port = parseInt(match[1]!, 10);
      if (port >= 1 && port <= 65535) {
        found.add(port);
      }
    }
  }

  return [...found];
}

// ── Parse ss -tlnp output ────────────────────────────────────────────
type SsEntry = {
  port: number;
  pid: number | null;
};

export function parseSsOutput(output: string): SsEntry[] {
  const results: SsEntry[] = [];
  const lines = output.split('\n').filter((l) => l.trim());

  for (const line of lines) {
    // Skip header lines
    if (line.startsWith('State') || line.includes('Recv-Q')) continue;

    // Match the local address:port — handles both IPv4 and IPv6
    // Patterns: "0.0.0.0:PORT", "127.0.0.1:PORT", "[::]:PORT", "*:PORT"
    const addrPortMatch = line.match(/(?:\S+:|\[[\w:]+\]:)(\d+)\s/);
    if (!addrPortMatch) continue;

    const port = parseInt(addrPortMatch[1]!, 10);
    if (port < 1 || port > 65535) continue;

    // Extract PID from users:(("name",pid=NNNN,...))
    const pidMatch = line.match(/pid=(\d+)/);
    const pid = pidMatch ? parseInt(pidMatch[1]!, 10) : null;

    results.push({ port, pid });
  }

  return results;
}
