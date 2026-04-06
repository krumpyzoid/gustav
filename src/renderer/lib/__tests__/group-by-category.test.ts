import { describe, it, expect } from 'vitest';
import { groupByCategory } from '../group-by-category';
import type { SessionEntry } from '../../../main/domain/types';

function entry(overrides: Partial<SessionEntry> = {}): SessionEntry {
  return {
    repo: 'myrepo',
    branch: 'main',
    tmuxSession: null,
    status: 'none',
    worktreePath: null,
    isMainWorktree: false,
    ...overrides,
  };
}

describe('groupByCategory', () => {
  it('groups standalone entries', () => {
    const entries = [entry({ repo: 'standalone', branch: 'scratch', tmuxSession: 'scratch' })];
    const result = groupByCategory(entries, new Map());
    expect(result.standalone).toHaveLength(1);
    expect(result.standalone[0].branch).toBe('scratch');
  });

  it('groups repo with active session under ACTIVE', () => {
    const entries = [entry({ repo: 'gustav', branch: 'main', tmuxSession: 'gustav/main' })];
    const repos = new Map([['gustav', '/home/user/gustav']]);
    const result = groupByCategory(entries, repos);
    expect(result.active.has('gustav')).toBe(true);
    expect(result.idle).toEqual([]);
  });

  it('groups pinned repo with no entries under IDLE', () => {
    const entries: SessionEntry[] = [];
    const repos = new Map([['old-lib', '/home/user/old-lib']]);
    const result = groupByCategory(entries, repos);
    expect(result.idle).toEqual(['old-lib']);
    expect(result.active.size).toBe(0);
  });

  it('groups pinned repo with only orphaned worktrees under IDLE', () => {
    const entries = [entry({ repo: 'myrepo', branch: 'feat', tmuxSession: null })];
    const repos = new Map([['myrepo', '/home/user/myrepo']]);
    const result = groupByCategory(entries, repos);
    expect(result.idle).toEqual(['myrepo']);
  });

  it('moves repo from IDLE to ACTIVE when session appears', () => {
    const repos = new Map([['myrepo', '/home/user/myrepo']]);

    // No sessions → IDLE
    const idleResult = groupByCategory([], repos);
    expect(idleResult.idle).toEqual(['myrepo']);

    // Session appears → ACTIVE
    const entries = [entry({ repo: 'myrepo', branch: 'main', tmuxSession: 'myrepo/main' })];
    const activeResult = groupByCategory(entries, repos);
    expect(activeResult.active.has('myrepo')).toBe(true);
    expect(activeResult.idle).toEqual([]);
  });

  it('returns empty collections when there are no entries', () => {
    const result = groupByCategory([], new Map());
    expect(result.standalone).toEqual([]);
    expect(result.active.size).toBe(0);
    expect(result.idle).toEqual([]);
  });

  it('puts non-pinned repo with active session under ACTIVE', () => {
    const entries = [entry({ repo: 'external', branch: 'dev', tmuxSession: 'external/dev' })];
    const repos = new Map(); // not pinned
    const result = groupByCategory(entries, repos);
    expect(result.active.has('external')).toBe(true);
  });

  it('sorts entries within active groups: main worktree first, then by branch', () => {
    const entries = [
      entry({ repo: 'myrepo', branch: 'feat-z', tmuxSession: 'myrepo/feat-z' }),
      entry({ repo: 'myrepo', branch: 'main', tmuxSession: 'myrepo/main', isMainWorktree: true }),
      entry({ repo: 'myrepo', branch: 'feat-a', tmuxSession: null }),
    ];
    const repos = new Map([['myrepo', '/home/user/myrepo']]);
    const result = groupByCategory(entries, repos);
    const group = result.active.get('myrepo')!;
    expect(group[0].branch).toBe('main');
    expect(group[1].branch).toBe('feat-a');
    expect(group[2].branch).toBe('feat-z');
  });
});
