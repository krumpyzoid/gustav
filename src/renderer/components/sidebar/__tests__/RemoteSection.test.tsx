// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const remoteState = {
  defaultWorkspace: { workspace: null, sessions: [], repoGroups: [], status: 'none' as const },
  workspaces: [
    {
      workspace: { id: 'ws1', name: 'RemoteDev', directory: '/srv/dev' },
      sessions: [],
      repoGroups: [],
      status: 'none' as const,
    },
  ],
  windows: [],
};

let storeState: Record<string, unknown>;

vi.mock('../../../hooks/use-app-state', () => ({
  useAppStore: Object.assign(() => storeState, { getState: () => storeState }),
  refreshState: vi.fn(),
}));

beforeEach(() => {
  storeState = {
    remoteState,
    remoteConnectionStatus: 'connected',
  };
});

import { RemoteSection } from '../RemoteSection';

describe('RemoteSection', () => {
  it('forwards onNewSession with workspace name and directory when the user picks "Create new session"', async () => {
    const onNewSession = vi.fn();
    const user = userEvent.setup();

    render(<RemoteSection onNewSession={onNewSession} />);

    // Open the accordion's "+" dropdown.
    const plus = screen.getAllByTitle(/Add session or pin repos/i)[0];
    await user.click(plus);

    await user.click(screen.getByRole('button', { name: 'Create new session' }));

    expect(onNewSession).toHaveBeenCalledWith('RemoteDev', '/srv/dev');
  });

  it('forwards onAddWorktree from a remote repo group affordance', async () => {
    const onAddWorktree = vi.fn();
    storeState.remoteState = {
      ...remoteState,
      workspaces: [
        {
          workspace: { id: 'ws1', name: 'RemoteDev', directory: '/srv/dev' },
          sessions: [],
          repoGroups: [
            {
              repoName: 'repo',
              repoRoot: '/srv/dev/repo',
              currentBranch: 'main',
              sessions: [],
            },
          ],
          status: 'none' as const,
        },
      ],
    };

    render(<RemoteSection onAddWorktree={onAddWorktree} />);

    // Hover the repo header to reveal the GitBranchPlus affordance — JSDOM
    // does not actually toggle :hover styles, but the element is still in
    // the DOM with display=hidden via the group-hover class. We can find it
    // by title.
    const addBtn = await screen.findByTitle(/Add worktree/i);
    const user = userEvent.setup();
    await user.click(addBtn);

    expect(onAddWorktree).toHaveBeenCalledWith('repo', '/srv/dev/repo', 'RemoteDev');
  });
});
