import { describe, it, expect } from 'vitest';
import { worstStatus } from '../types';
import type { ClaudeStatus, PinnedRepo, PersistedSession, Workspace, RepoGroupState, WindowSpec } from '../types';

describe('worstStatus', () => {
  it('returns none for empty array', () => {
    expect(worstStatus([])).toBe('none');
  });

  it('returns the single status when array has one element', () => {
    expect(worstStatus(['busy'])).toBe('busy');
  });

  it('ranks action as worst', () => {
    expect(worstStatus(['done', 'busy', 'action', 'new'])).toBe('action');
  });

  it('ranks busy above done and new', () => {
    expect(worstStatus(['done', 'new', 'busy'])).toBe('busy');
  });

  it('ranks done above new', () => {
    expect(worstStatus(['new', 'done', 'none'])).toBe('done');
  });

  it('ranks new above none', () => {
    expect(worstStatus(['none', 'new'])).toBe('new');
  });

  it('returns none when all statuses are none', () => {
    expect(worstStatus(['none', 'none'])).toBe('none');
  });

  it('handles duplicates correctly', () => {
    expect(worstStatus(['busy', 'busy', 'done'])).toBe('busy');
  });
});

describe('PinnedRepo type', () => {
  it('has path and repoName fields', () => {
    const repo: PinnedRepo = { path: '/home/user/project', repoName: 'project' };
    expect(repo.path).toBe('/home/user/project');
    expect(repo.repoName).toBe('project');
  });
});

describe('PersistedSession type', () => {
  it('has tmuxSession, type, directory, and windows fields', () => {
    const session: PersistedSession = {
      tmuxSession: 'Work/api/_dir',
      type: 'directory',
      directory: '/home/user/api',
      windows: [
        { name: 'Claude Code', kind: 'claude' },
        { name: 'Git', kind: 'command', command: 'lazygit' },
        { name: 'Shell', kind: 'command' },
      ],
    };
    expect(session.tmuxSession).toBe('Work/api/_dir');
    expect(session.type).toBe('directory');
    expect(session.windows).toHaveLength(3);
  });
});

describe('Workspace type extensions', () => {
  it('supports optional pinnedRepos and sessions fields', () => {
    const ws: Workspace = {
      id: '123',
      name: 'Test',
      directory: '/tmp',
      pinnedRepos: [{ path: '/tmp/repo', repoName: 'repo' }],
      sessions: [{
        tmuxSession: 'Test/repo/_dir',
        type: 'directory',
        directory: '/tmp/repo',
        windows: [
          { name: 'Claude Code', kind: 'claude' },
          { name: 'Shell', kind: 'command' },
        ],
      }],
    };
    expect(ws.pinnedRepos).toHaveLength(1);
    expect(ws.sessions).toHaveLength(1);
  });
});

describe('RepoGroupState type', () => {
  it('includes currentBranch field', () => {
    const rg: RepoGroupState = {
      repoName: 'api',
      repoRoot: '/home/user/api',
      currentBranch: 'main',
      sessions: [],
    };
    expect(rg.currentBranch).toBe('main');
  });
});

