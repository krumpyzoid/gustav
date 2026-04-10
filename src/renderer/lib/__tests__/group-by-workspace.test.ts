import { describe, it, expect } from 'vitest';
import { groupByWorkspace } from '../group-by-workspace';
import type { WorkspaceAppState, SessionTab, Workspace, ClaudeStatus } from '../../../main/domain/types';

function tab(overrides: Partial<SessionTab> = {}): SessionTab {
  return {
    workspaceId: null,
    type: 'workspace',
    tmuxSession: 'test',
    repoName: null,
    branch: null,
    worktreePath: null,
    status: 'none',
    active: true,
    ...overrides,
  };
}

function ws(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: 'ws1',
    name: 'Project',
    directory: '/home/user/project',
    ...overrides,
  };
}

describe('groupByWorkspace', () => {
  it('sorts workspace sessions before repo groups', () => {
    const state: WorkspaceAppState = {
      defaultWorkspace: { workspace: null, sessions: [], repoGroups: [], status: 'none' },
      workspaces: [{
        workspace: ws(),
        sessions: [tab({ tmuxSession: 'Project/_ws', type: 'workspace' })],
        repoGroups: [{
          repoName: 'api',
          repoRoot: '/home/user/project/api',
          currentBranch: null,
          sessions: [tab({ tmuxSession: 'Project/api/_dir', type: 'directory', repoName: 'api' })],
        }],
        status: 'none',
      }],
      windows: [],
    };

    const result = groupByWorkspace(state);
    expect(result.workspaces[0].sessions[0].type).toBe('workspace');
    expect(result.workspaces[0].repoGroups[0].repoName).toBe('api');
  });

  it('sorts directory sessions before worktrees within repo groups', () => {
    const state: WorkspaceAppState = {
      defaultWorkspace: { workspace: null, sessions: [], repoGroups: [], status: 'none' },
      workspaces: [{
        workspace: ws(),
        sessions: [],
        repoGroups: [{
          repoName: 'api',
          repoRoot: '',
          currentBranch: null,
          sessions: [
            tab({ type: 'worktree', repoName: 'api', branch: 'feat-z', tmuxSession: 'Project/api/feat-z' }),
            tab({ type: 'directory', repoName: 'api', tmuxSession: 'Project/api/_dir' }),
            tab({ type: 'worktree', repoName: 'api', branch: 'feat-a', tmuxSession: 'Project/api/feat-a' }),
          ],
        }],
        status: 'none',
      }],
      windows: [],
    };

    const result = groupByWorkspace(state);
    const sessions = result.workspaces[0].repoGroups[0].sessions;
    expect(sessions[0].type).toBe('directory');
    expect(sessions[1].branch).toBe('feat-a');
    expect(sessions[2].branch).toBe('feat-z');
  });

  it('computes workspace status as worst across all children', () => {
    const state: WorkspaceAppState = {
      defaultWorkspace: { workspace: null, sessions: [], repoGroups: [], status: 'none' },
      workspaces: [{
        workspace: ws(),
        sessions: [tab({ status: 'done' as ClaudeStatus })],
        repoGroups: [{
          repoName: 'api',
          repoRoot: '',
          currentBranch: null,
          sessions: [tab({ status: 'action' as ClaudeStatus, type: 'directory', repoName: 'api' })],
        }],
        status: 'action', // pre-computed by backend
      }],
      windows: [],
    };

    const result = groupByWorkspace(state);
    expect(result.workspaces[0].status).toBe('action');
  });

  it('places standalone sessions in default workspace', () => {
    const state: WorkspaceAppState = {
      defaultWorkspace: {
        workspace: null,
        sessions: [tab({ tmuxSession: '_standalone/scratch' })],
        repoGroups: [],
        status: 'none',
      },
      workspaces: [],
      windows: [],
    };

    const result = groupByWorkspace(state);
    expect(result.defaultWorkspace.sessions).toHaveLength(1);
    expect(result.defaultWorkspace.sessions[0].tmuxSession).toBe('_standalone/scratch');
  });
});
