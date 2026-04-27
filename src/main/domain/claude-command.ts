/**
 * Strips Gustav-managed flags (`--resume <token>`, `--continue`) from a freeform
 * Claude args string. Whitespace-token based; the `=` form (e.g. `--resume=abc`)
 * is not supported. Used so user-supplied resume/continue cannot collide with
 * the session-id Gustav tracks for restore.
 */
export function stripResumeContinueFlags(args: string): string {
  const tokens = args.trim().split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === '--continue') continue;
    if (t === '--resume') {
      const next = tokens[i + 1];
      if (next !== undefined && !next.startsWith('--')) i++;
      continue;
    }
    out.push(t);
  }
  return out.join(' ');
}

/**
 * Builds the claude command line for a tab. Gustav owns continuity:
 * - if `claudeSessionId` is tracked, append `--resume <id>`
 * - otherwise return bare `claude` (plus user args). No `--continue` is added.
 */
export function composeClaudeCommand(spec: {
  args?: string;
  claudeSessionId?: string;
}): string {
  const cleaned = stripResumeContinueFlags(spec.args ?? '');
  const parts = ['claude'];
  if (cleaned) parts.push(cleaned);
  if (spec.claudeSessionId) parts.push(`--resume ${spec.claudeSessionId}`);
  return parts.join(' ');
}
