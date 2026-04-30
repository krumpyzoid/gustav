// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SessionTransport } from '../../../lib/transport/session-transport';

// Stub the app store — dialogs read it for workspace lookup and refreshState.
const storeState = {
  workspaces: [
    { workspace: { id: 'ws1', name: 'Dev', directory: '/srv/dev' }, sessions: [], repoGroups: [], status: 'none' },
  ],
};
vi.mock('../../../hooks/use-app-state', () => ({
  useAppStore: Object.assign(() => storeState, { getState: () => storeState }),
  refreshState: vi.fn(),
}));

const api = {
  // Defaults that should NOT be hit when a transport prop is supplied.
  createWorkspaceSession: vi.fn(),
  createRepoSession: vi.fn(),
  createStandaloneSession: vi.fn(),
  createWorktree: vi.fn(),
  getBranches: vi.fn().mockResolvedValue([]),
  selectDirectory: vi.fn(),
};

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset?.();
  api.getBranches.mockResolvedValue([]);
  // @ts-expect-error — partial api for tests
  globalThis.window.api = api;
});

function makeTransport(overrides: Partial<SessionTransport> = {}, kind: 'local' | 'remote' = 'remote'): SessionTransport {
  return {
    kind,
    ownsWindows: kind === 'remote',
    sendPtyInput: vi.fn(),
    sendPtyResize: vi.fn(),
    onPtyData: vi.fn(() => () => {}),
    getState: vi.fn(),
    onStateUpdate: vi.fn(() => () => {}),
    switchSession: vi.fn(),
    sleepSession: vi.fn(),
    wakeSession: vi.fn(),
    destroySession: vi.fn(),
    selectWindow: vi.fn(),
    newWindow: vi.fn(),
    killWindow: vi.fn(),
    setWindowOrder: vi.fn(),
    createWorkspaceSession: vi.fn().mockResolvedValue({ success: true, data: 'Dev/_ws' }),
    createRepoSession: vi.fn().mockResolvedValue({ success: true, data: 'Dev/repo/main' }),
    createStandaloneSession: vi.fn().mockResolvedValue({ success: true, data: '_standalone/x' }),
    getBranches: vi.fn().mockResolvedValue([]),
    detach: vi.fn(),
    ...overrides,
  };
}

import { NewSessionDialog } from '../NewSessionDialog';
import { NewStandaloneDialog } from '../NewStandaloneDialog';
import { NewWorktreeDialog } from '../NewWorktreeDialog';

describe('NewSessionDialog — transport routing', () => {
  it('routes Create through transport.createWorkspaceSession when a transport prop is provided', async () => {
    const user = userEvent.setup();
    const transport = makeTransport();

    render(<NewSessionDialog open onClose={() => {}} workspaceId="ws1" transport={transport} />);

    await user.type(screen.getByPlaceholderText(/refactor, debug, docs/i), 'scratch');
    await user.click(screen.getByRole('button', { name: /create/i }));

    expect(transport.createWorkspaceSession).toHaveBeenCalledWith('Dev', '/srv/dev', 'scratch');
    expect(api.createWorkspaceSession).not.toHaveBeenCalled();
  });

  it('falls back to window.api.createWorkspaceSession when no transport is provided', async () => {
    const user = userEvent.setup();
    api.createWorkspaceSession.mockResolvedValue({ success: true, data: 'Dev/_ws' });

    render(<NewSessionDialog open onClose={() => {}} workspaceId="ws1" />);

    await user.type(screen.getByPlaceholderText(/refactor, debug, docs/i), 'scratch');
    await user.click(screen.getByRole('button', { name: /create/i }));

    expect(api.createWorkspaceSession).toHaveBeenCalledWith('Dev', '/srv/dev', 'scratch');
  });
});

describe('NewStandaloneDialog — transport routing', () => {
  it('routes Create through transport.createStandaloneSession when a transport prop is provided', async () => {
    const user = userEvent.setup();
    const transport = makeTransport();

    render(<NewStandaloneDialog open onClose={() => {}} transport={transport} />);

    await user.type(screen.getByPlaceholderText(/scratch/i), 'scratch');
    // Remote: no Browse button — type the path directly.
    await user.type(screen.getByPlaceholderText(/\/home\/user\/dir/i), '/srv/scratch');
    await user.click(screen.getByRole('button', { name: /create/i }));

    expect(transport.createStandaloneSession).toHaveBeenCalledWith('scratch', '/srv/scratch');
    expect(api.createStandaloneSession).not.toHaveBeenCalled();
  });

  it('hides the Browse button when transport is remote', () => {
    const transport = makeTransport({}, 'remote');
    render(<NewStandaloneDialog open onClose={() => {}} transport={transport} />);
    expect(screen.queryByRole('button', { name: /browse/i })).toBeNull();
  });

  it('shows the Browse button when transport is local (or no transport)', () => {
    render(<NewStandaloneDialog open onClose={() => {}} />);
    expect(screen.getByRole('button', { name: /browse/i })).toBeInTheDocument();
  });
});

describe('NewWorktreeDialog — transport routing', () => {
  it('uses transport.getBranches when a transport prop is provided', async () => {
    const { waitFor } = await import('@testing-library/react');
    const transport = makeTransport({
      getBranches: vi.fn().mockResolvedValue([{ name: 'feat/x', isRemote: false }]),
    });

    render(
      <NewWorktreeDialog
        open
        onClose={() => {}}
        repo="repo"
        repoRoot="/srv/repo"
        workspaceName="Dev"
        transport={transport}
      />,
    );

    await waitFor(() => expect(transport.getBranches).toHaveBeenCalledWith('/srv/repo'));
    expect(api.getBranches).not.toHaveBeenCalled();
  });

  it('routes Create through transport.createRepoSession with worktree mode', async () => {
    const user = userEvent.setup();
    const transport = makeTransport();

    render(
      <NewWorktreeDialog
        open
        onClose={() => {}}
        repo="repo"
        repoRoot="/srv/repo"
        workspaceName="Dev"
        transport={transport}
      />,
    );

    await user.type(screen.getByPlaceholderText(/feat-my-feature/i), 'feat-x');
    await user.click(screen.getByRole('button', { name: /create/i }));

    expect(transport.createRepoSession).toHaveBeenCalledWith('Dev', '/srv/repo', 'worktree', 'feat-x', 'origin/main');
    expect(api.createRepoSession).not.toHaveBeenCalled();
  });
});
