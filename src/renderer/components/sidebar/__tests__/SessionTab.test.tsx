// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SessionTab as SessionTabType, WindowInfo } from '../../../../main/domain/types';

// ── Store mock ────────────────────────────────────────────────────

type StoreState = {
  activeSession: string | null;
  remoteActiveSession: string | null;
  remotePtyChannelId: number | null;
  setActiveSession: (s: string | null) => void;
  setWindows: (w: WindowInfo[]) => void;
  setRemoteActiveSession: (s: string | null) => void;
  setIsRemoteSession: (b: boolean) => void;
  setRemotePtyChannelId: (id: number | null) => void;
};

let storeState: StoreState;

vi.mock('../../../hooks/use-app-state', () => ({
  useAppStore: Object.assign(
    () => storeState,
    {
      getState: () => storeState,
    },
  ),
  refreshState: vi.fn(),
}));

const api = {
  remoteSessionCommand: vi.fn(),
  switchSession: vi.fn().mockResolvedValue({ success: true, data: [] }),
  wakeSession: vi.fn().mockResolvedValue({ success: false }),
};

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset?.();
  api.switchSession.mockResolvedValue({ success: true, data: [] });
  api.wakeSession.mockResolvedValue({ success: false });
  // @ts-expect-error — partial window.api for tests
  globalThis.window.api = api;
  storeState = {
    activeSession: null,
    remoteActiveSession: null,
    remotePtyChannelId: null,
    setActiveSession: vi.fn((s) => { storeState.activeSession = s; }),
    setWindows: vi.fn(),
    setRemoteActiveSession: vi.fn((s) => { storeState.remoteActiveSession = s; }),
    setIsRemoteSession: vi.fn(),
    setRemotePtyChannelId: vi.fn((id) => { storeState.remotePtyChannelId = id; }),
  };
});

import { SessionTab } from '../SessionTab';

function makeTab(overrides: Partial<SessionTabType> = {}): SessionTabType {
  return {
    workspaceId: 'ws1',
    type: 'directory',
    tmuxSession: 'ws/repo/_dir',
    repoName: 'repo',
    branch: null,
    worktreePath: null,
    status: 'none',
    active: true,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────

describe('SessionTab — remote click', () => {
  it('populates window tabs after attaching to a remote PTY', async () => {
    const user = userEvent.setup();
    const remoteWindows: WindowInfo[] = [
      { index: 0, name: 'Editor', active: true },
      { index: 1, name: 'Logs', active: false },
    ];
    api.remoteSessionCommand.mockImplementation((action: string) => {
      if (action === 'attach-pty') return Promise.resolve({ success: true, data: { channelId: 42 } });
      if (action === 'list-windows') return Promise.resolve({ success: true, data: remoteWindows });
      return Promise.resolve({ success: true });
    });

    render(<SessionTab tab={makeTab()} isRemote />);
    await user.click(screen.getByRole('button', { name: /repo/i }));

    expect(api.remoteSessionCommand).toHaveBeenCalledWith(
      'list-windows',
      expect.objectContaining({ session: 'ws/repo/_dir' }),
    );
    expect(storeState.setWindows).toHaveBeenCalledWith(remoteWindows);
  });
});
