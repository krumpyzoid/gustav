import type { SessionEntry } from '../../main/domain/types';

export interface CategoryGroups {
  standalone: SessionEntry[];
  active: Map<string, SessionEntry[]>;
  idle: string[];
}

function sortEntries(entries: SessionEntry[]): SessionEntry[] {
  return [...entries].sort((a, b) => {
    if (a.isMainWorktree && !b.isMainWorktree) return -1;
    if (!a.isMainWorktree && b.isMainWorktree) return 1;
    return a.branch.localeCompare(b.branch);
  });
}

export function groupByCategory(
  entries: SessionEntry[],
  pinnedRepos: Map<string, string>,
): CategoryGroups {
  const standalone: SessionEntry[] = [];
  const repoEntries = new Map<string, SessionEntry[]>();

  for (const entry of entries) {
    if (entry.repo === 'standalone') {
      standalone.push(entry);
    } else {
      const group = repoEntries.get(entry.repo) ?? [];
      group.push(entry);
      repoEntries.set(entry.repo, group);
    }
  }

  const active = new Map<string, SessionEntry[]>();
  const idleSet = new Set<string>();

  // Check all repos with entries
  for (const [repo, group] of repoEntries) {
    const hasActiveSession = group.some((e) => e.tmuxSession !== null);
    if (hasActiveSession) {
      active.set(repo, sortEntries(group));
    } else if (pinnedRepos.has(repo)) {
      idleSet.add(repo);
    }
  }

  // Pinned repos with no entries at all → idle
  for (const repo of pinnedRepos.keys()) {
    if (!active.has(repo) && !idleSet.has(repo)) {
      idleSet.add(repo);
    }
  }

  return {
    standalone,
    active,
    idle: [...idleSet].sort(),
  };
}
