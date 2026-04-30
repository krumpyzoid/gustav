/**
 * Bound a remotely-supplied terminal dimension (cols or rows) to a sane
 * range. Inputs are post-auth — this is defence-in-depth against a buggy
 * or hostile client passing NaN, Infinity, fractional, negative, or
 * absurdly large values that would propagate into node-pty / xterm.js
 * resize calls and could trigger large allocations.
 *
 * Returns `def` for any invalid or out-of-range input. Truncates
 * fractional values to integers so node-pty's expectations are met.
 */
const MAX_PTY_DIM = 1000;

export function clampPtyDim(value: unknown, def: number): number {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n)) return def;
  if (n < 1 || n > MAX_PTY_DIM) return def;
  return n;
}
