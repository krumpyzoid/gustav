// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { WindowInfo } from '../../../../main/domain/types';

// ── Mocks ─────────────────────────────────────────────────────────

type SortableProps = {
  itemId: string;
  scope: string;
  dragType: string;
  onReorder: (draggedId: string, targetId: string, edge: 'top' | 'bottom') => void;
  onDropEffect?: () => void;
};
const sortableProps: Record<string, SortableProps> = {};

vi.mock('../../sidebar/SortableItem', () => ({
  SortableItem: ({
    children,
    itemId,
    scope,
    dragType,
    onReorder,
    onDropEffect,
  }: SortableProps & { children: React.ReactNode }) => {
    sortableProps[itemId] = { itemId, scope, dragType, onReorder, onDropEffect };
    return <div data-testid={`sortable-${itemId}`}>{children}</div>;
  },
}));

const focusTerminal = vi.fn();
vi.mock('../../../hooks/use-terminal', () => ({
  focusTerminal: () => focusTerminal(),
}));

let storeState: {
  windows: WindowInfo[];
  activeSession: string | null;
  remoteActiveSession: string | null;
  isRemoteSession: boolean;
  remotePtyChannelId: number | null;
  setWindows: (w: WindowInfo[]) => void;
  setActiveSession: (s: string | null) => void;
  setRemoteActiveSession: (s: string | null) => void;
  setIsRemoteSession: (b: boolean) => void;
  setRemotePtyChannelId: (id: number | null) => void;
};

vi.mock('../../../hooks/use-app-state', () => ({
  useAppStore: () => storeState,
}));

const api = {
  selectWindow: vi.fn().mockResolvedValue({ success: true }),
  newWindow: vi.fn().mockResolvedValue({ success: true }),
  killWindow: vi.fn().mockResolvedValue({ success: true }),
  sleepSession: vi.fn().mockResolvedValue({ success: true }),
  setWindowOrder: vi.fn().mockResolvedValue({ success: true }),
  remoteSessionCommand: vi.fn().mockResolvedValue({ success: true }),
};
beforeEach(() => {
  for (const k of Object.keys(sortableProps)) delete sortableProps[k];
  focusTerminal.mockReset();
  for (const fn of Object.values(api)) fn.mockClear();
  // @ts-expect-error — define a partial window.api for tests
  globalThis.window.api = api;
  storeState = {
    windows: [
      { index: 0, name: 'Editor', active: false },
      { index: 1, name: 'Logs', active: true },
      { index: 2, name: 'Tests', active: false },
    ],
    activeSession: 'Dev/_ws',
    remoteActiveSession: null,
    isRemoteSession: false,
    remotePtyChannelId: null,
    setWindows: vi.fn((w) => {
      storeState.windows = w;
    }),
    setActiveSession: vi.fn(),
    setRemoteActiveSession: vi.fn(),
    setIsRemoteSession: vi.fn(),
    setRemotePtyChannelId: vi.fn(),
  };
});

import { TabBar } from '../TabBar';

// ── Tests ─────────────────────────────────────────────────────────

describe('TabBar', () => {
  it('renders one tab per window with the window name', () => {
    render(<TabBar />);
    expect(screen.getByRole('button', { name: /editor/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /logs/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /tests/i })).toBeInTheDocument();
  });

  it('wraps each tab in a SortableItem with dragType, scope and focus-on-drop', () => {
    render(<TabBar />);
    for (const name of ['Editor', 'Logs', 'Tests']) {
      const props = sortableProps[name];
      expect(props).toBeDefined();
      expect(props.dragType).toBe('window-tab');
      expect(props.scope).toBe('window-tabs:Dev/_ws');
      // onDropEffect must be the focusTerminal helper — verified by behaviour:
      expect(typeof props.onDropEffect).toBe('function');
      props.onDropEffect!();
    }
    expect(focusTerminal).toHaveBeenCalledTimes(3);
  });

  it('reorders windows and persists via setWindowOrder when SortableItem fires onReorder', async () => {
    render(<TabBar />);

    // Drag "Tests" above "Logs" → ['Editor','Tests','Logs']
    sortableProps['Tests'].onReorder('Tests', 'Logs', 'top');

    expect(storeState.setWindows).toHaveBeenCalledOnce();
    const optimistic = (storeState.setWindows as ReturnType<typeof vi.fn>).mock.calls[0][0] as WindowInfo[];
    expect(optimistic.map((w) => w.name)).toEqual(['Editor', 'Tests', 'Logs']);

    // Active flag preserved
    expect(optimistic.find((w) => w.name === 'Logs')?.active).toBe(true);

    // Wait a tick for the await
    await Promise.resolve();
    expect(api.setWindowOrder).toHaveBeenCalledWith('Dev/_ws', ['Editor', 'Tests', 'Logs']);
  });

  it('reorders below the target when edge is "bottom"', () => {
    render(<TabBar />);

    // Drag "Editor" below "Tests" → ['Logs','Tests','Editor']
    sortableProps['Editor'].onReorder('Editor', 'Tests', 'bottom');

    const next = (storeState.setWindows as ReturnType<typeof vi.fn>).mock.calls[0][0] as WindowInfo[];
    expect(next.map((w) => w.name)).toEqual(['Logs', 'Tests', 'Editor']);
  });

  it('clicking a tab still calls selectWindow (no reorder)', async () => {
    render(<TabBar />);

    await userEvent.click(screen.getByRole('button', { name: /editor/i }));

    expect(api.selectWindow).toHaveBeenCalledWith('Dev/_ws', 'Editor');
    expect(api.setWindowOrder).not.toHaveBeenCalled();
  });

  it('clicking a tab refocuses the terminal after selectWindow resolves', async () => {
    render(<TabBar />);

    await userEvent.click(screen.getByRole('button', { name: /editor/i }));

    expect(focusTerminal).toHaveBeenCalledOnce();
  });

  it('focuses the terminal after creating a new window tab', async () => {
    render(<TabBar />);

    // Open the input
    await userEvent.click(screen.getByRole('button', { name: '+' }));
    const input = screen.getByPlaceholderText(/tab name/i) as HTMLInputElement;
    await userEvent.type(input, 'Notes{Enter}');

    expect(api.newWindow).toHaveBeenCalledWith('Dev/_ws', 'Notes');
    expect(focusTerminal).toHaveBeenCalledOnce();
  });

  it('does not focus the terminal when handleAdd early-returns on empty input', async () => {
    render(<TabBar />);

    await userEvent.click(screen.getByRole('button', { name: '+' }));
    const input = screen.getByPlaceholderText(/tab name/i) as HTMLInputElement;
    await userEvent.type(input, '   {Enter}');

    expect(api.newWindow).not.toHaveBeenCalled();
    expect(focusTerminal).not.toHaveBeenCalled();
  });
});

describe('TabBar — remote session routing', () => {
  beforeEach(() => {
    // Switch the store into "remote mode": no local active session,
    // remote session and PTY channel set instead.
    storeState.activeSession = null;
    storeState.remoteActiveSession = 'Dev/_ws';
    storeState.isRemoteSession = true;
    storeState.remotePtyChannelId = 7;
  });

  it('still renders one tab per window when in remote mode', () => {
    render(<TabBar />);
    expect(screen.getByRole('button', { name: /editor/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /logs/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /tests/i })).toBeInTheDocument();
  });

  it('clicking a tab dispatches select-window remotely instead of local selectWindow', async () => {
    render(<TabBar />);

    await userEvent.click(screen.getByRole('button', { name: /editor/i }));

    expect(api.remoteSessionCommand).toHaveBeenCalledWith(
      'select-window',
      { session: 'Dev/_ws', window: 'Editor' },
    );
    expect(api.selectWindow).not.toHaveBeenCalled();
  });

  it('adding a new tab dispatches new-window remotely instead of local newWindow', async () => {
    render(<TabBar />);

    await userEvent.click(screen.getByRole('button', { name: '+' }));
    const input = screen.getByPlaceholderText(/tab name/i) as HTMLInputElement;
    await userEvent.type(input, 'Notes{Enter}');

    expect(api.remoteSessionCommand).toHaveBeenCalledWith(
      'new-window',
      { session: 'Dev/_ws', name: 'Notes' },
    );
    expect(api.newWindow).not.toHaveBeenCalled();
  });

  it('reordering dispatches set-window-order remotely instead of local setWindowOrder', async () => {
    render(<TabBar />);

    sortableProps['Tests'].onReorder('Tests', 'Logs', 'top');
    await Promise.resolve();

    expect(api.remoteSessionCommand).toHaveBeenCalledWith(
      'set-window-order',
      { session: 'Dev/_ws', names: ['Editor', 'Tests', 'Logs'] },
    );
    expect(api.setWindowOrder).not.toHaveBeenCalled();
  });

  it('closing a non-last tab dispatches kill-window remotely instead of local killWindow', async () => {
    render(<TabBar />);

    // Hover-only "×" — find the close span inside the Editor tab and click it.
    const editorBtn = screen.getByRole('button', { name: /editor/i });
    const closeBtn = editorBtn.querySelector('span') as HTMLElement;
    await userEvent.click(closeBtn);

    expect(api.remoteSessionCommand).toHaveBeenCalledWith(
      'kill-window',
      { session: 'Dev/_ws', windowIndex: 0 },
    );
    expect(api.killWindow).not.toHaveBeenCalled();
  });

  it('uses the remote session name in the SortableItem scope', () => {
    render(<TabBar />);
    expect(sortableProps['Editor'].scope).toBe('window-tabs:Dev/_ws');
  });

  it('closing the last tab dispatches sleep-session remotely, detaches the PTY, and clears remote markers', async () => {
    storeState.windows = [{ index: 0, name: 'Editor', active: true }];

    render(<TabBar />);
    const editorBtn = screen.getByRole('button', { name: /editor/i });
    const closeBtn = editorBtn.querySelector('span') as HTMLElement;
    await userEvent.click(closeBtn);

    expect(api.remoteSessionCommand).toHaveBeenCalledWith(
      'sleep-session',
      { session: 'Dev/_ws' },
    );
    expect(api.remoteSessionCommand).toHaveBeenCalledWith(
      'detach-pty',
      { channelId: 7 },
    );
    expect(api.sleepSession).not.toHaveBeenCalled();
    expect(storeState.setRemoteActiveSession).toHaveBeenCalledWith(null);
    expect(storeState.setIsRemoteSession).toHaveBeenCalledWith(false);
    expect(storeState.setRemotePtyChannelId).toHaveBeenCalledWith(null);
  });
});
