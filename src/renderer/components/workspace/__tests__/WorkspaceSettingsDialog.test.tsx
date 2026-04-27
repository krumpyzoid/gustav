// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WorkspaceSettingsDialog } from '../WorkspaceSettingsDialog';
import type { Workspace } from '../../../../main/domain/types';
import type { TabConfig } from '../../../../main/domain/tab-config';

const globalsList: TabConfig[] = [
  { id: 'g1', name: 'Claude Code', kind: 'claude', appliesTo: 'both' },
  { id: 'g2', name: 'Git', kind: 'command', command: 'lazygit', appliesTo: 'repository' },
  { id: 'g3', name: 'Shell', kind: 'command', appliesTo: 'both' },
];

const mockApi = {
  getPreferences: vi.fn(),
  setWorkspaceDefaultTabs: vi.fn(),
};

beforeEach(() => {
  mockApi.getPreferences.mockReset();
  mockApi.setWorkspaceDefaultTabs.mockReset();
  mockApi.getPreferences.mockResolvedValue({ defaultTabs: globalsList });
  mockApi.setWorkspaceDefaultTabs.mockResolvedValue({ success: true, data: undefined });
  // @ts-expect-error inject test API
  globalThis.window.api = mockApi;
});

function renderDialog(workspace: Workspace) {
  return render(
    <WorkspaceSettingsDialog
      workspace={workspace}
      open
      onOpenChange={() => {}}
    />,
  );
}

const ws = (defaultTabs?: TabConfig[]): Workspace => ({
  id: 'w1',
  name: 'Acme',
  directory: '/path/acme',
  defaultTabs,
});

describe('WorkspaceSettingsDialog', () => {
  it('seeds the editor from globals when the workspace has no override', async () => {
    renderDialog(ws());
    await waitFor(() => expect(mockApi.getPreferences).toHaveBeenCalled());

    expect(screen.getByDisplayValue('Claude Code')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Git')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Shell')).toBeInTheDocument();
  });

  it('shows the workspace override unchanged when present', async () => {
    renderDialog(ws([{ id: 'o1', name: 'Notes', kind: 'command', appliesTo: 'standalone' }]));
    // No need to wait for getPreferences — override path skips it
    await waitFor(() => expect(screen.getByDisplayValue('Notes')).toBeInTheDocument());

    expect(screen.queryByDisplayValue('Git')).not.toBeInTheDocument();
  });

  it('saves the editor content verbatim — no appliesTo normalization', async () => {
    renderDialog(ws());
    await waitFor(() => expect(screen.getByDisplayValue('Git')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(mockApi.setWorkspaceDefaultTabs).toHaveBeenCalled());
    const [id, payload] = mockApi.setWorkspaceDefaultTabs.mock.calls[0];
    expect(id).toBe('w1');
    // Git row preserved with appliesTo='repository' (no force to 'standalone')
    expect(payload).toEqual(globalsList);
  });

  it('saves an empty list as an empty array (not null)', async () => {
    renderDialog(ws());
    await waitFor(() => expect(screen.getByDisplayValue('Git')).toBeInTheDocument());

    const deleteBtns = screen.getAllByRole('button', { name: /delete tab/i });
    for (const btn of deleteBtns) await userEvent.click(btn);

    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(mockApi.setWorkspaceDefaultTabs).toHaveBeenCalled());
    const [, payload] = mockApi.setWorkspaceDefaultTabs.mock.calls[0];
    expect(payload).toEqual([]);
  });

  it('reset to defaults sends null', async () => {
    renderDialog(ws([{ id: 'o1', name: 'Notes', kind: 'command', appliesTo: 'standalone' }]));
    await waitFor(() => expect(screen.getByDisplayValue('Notes')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: /reset to defaults/i }));

    await waitFor(() => expect(mockApi.setWorkspaceDefaultTabs).toHaveBeenCalled());
    const [id, payload] = mockApi.setWorkspaceDefaultTabs.mock.calls[0];
    expect(id).toBe('w1');
    expect(payload).toBeNull();
  });
});
