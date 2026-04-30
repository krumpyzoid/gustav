import type { WindowSpec } from '../domain/types';

export type LiveWindow = { index: number; name: string; active: boolean };

/**
 * Reorder a list of live tmux windows to match the user's saved visual order.
 *
 * - Persisted entries no longer present in the live list are dropped.
 * - Live entries not in the persisted order are appended at the end,
 *   preserving their relative order from the input.
 * - Active flags from the live list are preserved unchanged.
 */
export function applyPersistedWindowOrder<W extends LiveWindow>(
  live: W[],
  persisted: WindowSpec[],
): W[] {
  if (persisted.length === 0) return live.slice();

  const liveByName = new Map<string, W>();
  for (const w of live) liveByName.set(w.name, w);

  const ordered: W[] = [];
  const seen = new Set<string>();

  for (const spec of persisted) {
    const w = liveByName.get(spec.name);
    if (!w || seen.has(spec.name)) continue;
    seen.add(spec.name);
    ordered.push(w);
  }

  for (const w of live) {
    if (seen.has(w.name)) continue;
    ordered.push(w);
  }

  return ordered;
}
