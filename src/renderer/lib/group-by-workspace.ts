import type { WorkspaceAppState, WorkspaceState } from '../../main/domain/types';

function sortRepoSessions(ws: WorkspaceState): WorkspaceState {
  return {
    ...ws,
    repoGroups: ws.repoGroups.map((rg) => ({
      ...rg,
      sessions: [...rg.sessions].sort((a, b) => {
        // directory first, then worktrees alphabetically
        if (a.type === 'directory' && b.type !== 'directory') return -1;
        if (a.type !== 'directory' && b.type === 'directory') return 1;
        return (a.branch ?? '').localeCompare(b.branch ?? '');
      }),
    })),
  };
}

export function groupByWorkspace(state: WorkspaceAppState): WorkspaceAppState {
  return {
    defaultWorkspace: sortRepoSessions(state.defaultWorkspace),
    workspaces: state.workspaces.map(sortRepoSessions),
    windows: state.windows,
  };
}
