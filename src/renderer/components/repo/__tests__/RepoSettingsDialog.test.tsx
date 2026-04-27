// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RepoSettingsDialog } from '../RepoSettingsDialog';
import { useAppStore } from '../../../hooks/use-app-state';
import type { TabConfig } from '../../../../main/domain/tab-config';
import type { WorkspaceState } from '../../../../main/domain/types';

const globalsList: TabConfig[] = [
  { id: 'g1', name: 'Claude Code', kind: 'claude', appliesTo: 'both' },
  { id: 'g2', name: 'Git', kind: 'command', command: 'lazygit', appliesTo: 'repository' },
  { id: 'g3', name: 'Shell', kind: 'command', appliesTo: 'both' },
];

const mockApi = {
  getRepoConfig: vi.fn(),
  setRepoConfig: vi.fn(),
  getBranches: vi.fn(),
  getPreferences: vi.fn(),
};

function seedStore(workspaces: WorkspaceState[] = []) {
  useAppStore.setState({ workspaces });
}

beforeEach(() => {
  mockApi.getRepoConfig.mockReset();
  mockApi.setRepoConfig.mockReset();
  mockApi.getBranches.mockReset();
  mockApi.getPreferences.mockReset();
  mockApi.getRepoConfig.mockResolvedValue(null);
  mockApi.setRepoConfig.mockResolvedValue({ success: true, data: undefined });
  mockApi.getBranches.mockResolvedValue([
    { name: 'main', isLocal: true, isRemote: true },
    { name: 'origin/develop', isLocal: false, isRemote: true },
  ]);
  mockApi.getPreferences.mockResolvedValue({ defaultTabs: globalsList });
  // @ts-expect-error inject test API
  globalThis.window.api = mockApi;
  seedStore([]);
});

function renderDialog(workspaceId: string | null = null) {
  return render(
    <RepoSettingsDialog
      repoRoot="/home/user/api"
      repoName="api"
      workspaceId={workspaceId}
      open
      onOpenChange={() => {}}
    />,
  );
}

describe('RepoSettingsDialog', () => {
  it('renders four sections', async () => {
    renderDialog();
    await waitFor(() => expect(mockApi.getRepoConfig).toHaveBeenCalled());

    expect(screen.getByRole('heading', { name: /^Tabs$/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /^Environment$/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /^Post-Create Command$/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /^Base Branch$/ })).toBeInTheDocument();
  });

  // ── Seeding ──────────────────────────────────────────────────────

  it('seeds tabs from globals when no override and no workspace context', async () => {
    renderDialog(null);
    await waitFor(() => expect(mockApi.getPreferences).toHaveBeenCalled());

    expect(screen.getByDisplayValue('Claude Code')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Git')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Shell')).toBeInTheDocument();
  });

  it('seeds tabs from workspace.defaultTabs when workspace has an override', async () => {
    const workspaceTabs: TabConfig[] = [
      { id: 'w1', name: 'Notes', kind: 'command', appliesTo: 'standalone' },
      { id: 'w2', name: 'Build', kind: 'command', command: 'make', appliesTo: 'both' },
    ];
    seedStore([
      {
        workspace: { id: 'ws1', name: 'Acme', directory: '/path/acme', defaultTabs: workspaceTabs },
        sessions: [],
        repoGroups: [],
        status: 'none',
      },
    ]);

    renderDialog('ws1');
    await waitFor(() => expect(mockApi.getRepoConfig).toHaveBeenCalled());

    expect(screen.getByDisplayValue('Notes')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Build')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('Git')).not.toBeInTheDocument();
  });

  it('seeds tabs from globals when workspace has no override', async () => {
    seedStore([
      {
        workspace: { id: 'ws1', name: 'Acme', directory: '/path/acme' },
        sessions: [],
        repoGroups: [],
        status: 'none',
      },
    ]);

    renderDialog('ws1');
    await waitFor(() => expect(mockApi.getPreferences).toHaveBeenCalled());

    expect(screen.getByDisplayValue('Claude Code')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Git')).toBeInTheDocument();
  });

  it('shows the repo override unchanged when present (no seed)', async () => {
    mockApi.getRepoConfig.mockResolvedValue({
      tabs: [{ id: 'r1', name: 'Tests', kind: 'command', command: 'npm test', appliesTo: 'repository' }],
    });

    renderDialog(null);
    await waitFor(() => expect(mockApi.getRepoConfig).toHaveBeenCalled());

    expect(screen.getByDisplayValue('Tests')).toBeInTheDocument();
    // Globals are NOT seeded when override exists
    expect(screen.queryByDisplayValue('Claude Code')).not.toBeInTheDocument();
  });

  // ── Save ─────────────────────────────────────────────────────────

  it('saves tabs verbatim — no appliesTo normalization to "repository"', async () => {
    mockApi.getRepoConfig.mockResolvedValue({
      tabs: [{ id: 't1', name: 'Tests', kind: 'command', command: 'npm test', appliesTo: 'standalone' }],
    });

    renderDialog(null);
    await waitFor(() => expect(mockApi.getRepoConfig).toHaveBeenCalled());

    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(mockApi.setRepoConfig).toHaveBeenCalled());
    const [, payload] = mockApi.setRepoConfig.mock.calls[0];
    expect(payload.tabs[0].appliesTo).toBe('standalone');
  });

  it('saves the seeded list verbatim including a Git-tagged-repository row', async () => {
    renderDialog(null);
    await waitFor(() => expect(mockApi.getPreferences).toHaveBeenCalled());

    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(mockApi.setRepoConfig).toHaveBeenCalled());
    const [, payload] = mockApi.setRepoConfig.mock.calls[0];
    expect(payload.tabs).toEqual(globalsList);
  });

  it('reset to defaults sets the config to null', async () => {
    mockApi.getRepoConfig.mockResolvedValue({ baseBranch: 'origin/main' });

    renderDialog(null);
    await waitFor(() => expect(mockApi.getRepoConfig).toHaveBeenCalled());

    await userEvent.click(screen.getByRole('button', { name: /reset to defaults/i }));

    await waitFor(() => expect(mockApi.setRepoConfig).toHaveBeenCalled());
    const [repoRoot, payload] = mockApi.setRepoConfig.mock.calls[0];
    expect(repoRoot).toBe('/home/user/api');
    expect(payload).toBeNull();
  });

  it('Base Branch select lists branches and supports clearing', async () => {
    renderDialog(null);
    await waitFor(() => expect(mockApi.getBranches).toHaveBeenCalledWith('/home/user/api'));

    const select = screen.getByLabelText(/base branch/i);
    expect(select).toBeInTheDocument();

    const options = (select as HTMLSelectElement).querySelectorAll('option');
    const values = Array.from(options).map((o) => o.value);
    expect(values).toContain('');
    expect(values).toContain('main');
    expect(values).toContain('origin/develop');
  });
});
