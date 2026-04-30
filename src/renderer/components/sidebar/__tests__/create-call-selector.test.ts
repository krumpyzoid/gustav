import { describe, it, expect } from 'vitest';
import { chooseCreateCall } from '../create-call-selector';
import type { SessionTab } from '../../../../main/domain/types';

function tab(overrides: Partial<SessionTab>): SessionTab {
  return {
    workspaceId: 'ws1',
    type: 'directory',
    tmuxSession: 'Dev/repo/_dir',
    repoName: 'repo',
    branch: null,
    worktreePath: null,
    status: 'none',
    active: false,
    ...overrides,
  };
}

describe('chooseCreateCall', () => {
  it('returns a "workspace" descriptor when the tab type is workspace and props are populated', () => {
    const t = tab({ type: 'workspace', tmuxSession: 'Dev/_ws', repoName: null });
    const result = chooseCreateCall(t, { workspaceName: 'Dev', workspaceDir: '/srv/dev' });
    expect(result).toEqual({
      kind: 'workspace',
      workspaceName: 'Dev',
      workspaceDir: '/srv/dev',
      label: undefined,
    });
  });

  it('extracts a non-default workspace label from the tmux session suffix', () => {
    const t = tab({ type: 'workspace', tmuxSession: 'Dev/scratch', repoName: null });
    const result = chooseCreateCall(t, { workspaceName: 'Dev', workspaceDir: '/srv/dev' });
    expect(result).toEqual({
      kind: 'workspace',
      workspaceName: 'Dev',
      workspaceDir: '/srv/dev',
      label: 'scratch',
    });
  });

  it('returns a "worktree" descriptor for worktree tabs with full props', () => {
    const t = tab({ type: 'worktree', branch: 'feat/x', worktreePath: '/srv/repo/.worktrees/feat-x' });
    const result = chooseCreateCall(t, {
      workspaceName: 'Dev',
      repoRoot: '/srv/repo',
    });
    expect(result).toEqual({
      kind: 'worktree',
      workspaceName: 'Dev',
      repoRoot: '/srv/repo',
      branch: 'feat/x',
      worktreePath: '/srv/repo/.worktrees/feat-x',
    });
  });

  it('returns a "directory" descriptor for directory tabs with workspace + repo props', () => {
    const t = tab({ type: 'directory' });
    const result = chooseCreateCall(t, { workspaceName: 'Dev', repoRoot: '/srv/repo' });
    expect(result).toEqual({ kind: 'directory', workspaceName: 'Dev', repoRoot: '/srv/repo' });
  });

  it('returns "unsupported" when a workspace tab is missing workspaceName', () => {
    const t = tab({ type: 'workspace', tmuxSession: 'Dev/_ws', repoName: null });
    const result = chooseCreateCall(t, { workspaceDir: '/srv/dev' });
    expect(result.kind).toBe('unsupported');
    if (result.kind === 'unsupported') {
      expect(result.reason).toMatch(/workspaceName/);
    }
  });

  it('returns "unsupported" when a workspace tab is missing workspaceDir', () => {
    const t = tab({ type: 'workspace', tmuxSession: 'Dev/_ws', repoName: null });
    const result = chooseCreateCall(t, { workspaceName: 'Dev' });
    expect(result.kind).toBe('unsupported');
    if (result.kind === 'unsupported') {
      expect(result.reason).toMatch(/workspaceDir/);
    }
  });

  it('returns "unsupported" when a worktree tab is missing repoRoot', () => {
    const t = tab({ type: 'worktree', branch: 'feat/x', worktreePath: '/srv/repo/.worktrees/feat-x' });
    const result = chooseCreateCall(t, { workspaceName: 'Dev' });
    expect(result.kind).toBe('unsupported');
    if (result.kind === 'unsupported') {
      expect(result.reason).toMatch(/repoRoot/);
    }
  });

  it('returns "unsupported" when a worktree tab is missing branch or worktreePath', () => {
    const t1 = tab({ type: 'worktree', branch: null, worktreePath: '/p' });
    const r1 = chooseCreateCall(t1, { workspaceName: 'Dev', repoRoot: '/srv/repo' });
    expect(r1.kind).toBe('unsupported');

    const t2 = tab({ type: 'worktree', branch: 'feat/x', worktreePath: null });
    const r2 = chooseCreateCall(t2, { workspaceName: 'Dev', repoRoot: '/srv/repo' });
    expect(r2.kind).toBe('unsupported');
  });

  it('returns "unsupported" when a directory tab is missing repoRoot', () => {
    const t = tab({ type: 'directory' });
    const result = chooseCreateCall(t, { workspaceName: 'Dev' });
    expect(result.kind).toBe('unsupported');
    if (result.kind === 'unsupported') {
      expect(result.reason).toMatch(/repoRoot/);
    }
  });

  it('returns "unsupported" when a directory tab is missing workspaceName', () => {
    const t = tab({ type: 'directory' });
    const result = chooseCreateCall(t, { repoRoot: '/srv/repo' });
    expect(result.kind).toBe('unsupported');
    if (result.kind === 'unsupported') {
      expect(result.reason).toMatch(/workspaceName/);
    }
  });
});
