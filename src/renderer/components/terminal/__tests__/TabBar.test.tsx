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
  setWindows: (w: WindowInfo[]) => void;
  setActiveSession: (s: string | null) => void;
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
    setWindows: vi.fn((w) => {
      storeState.windows = w;
    }),
    setActiveSession: vi.fn(),
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
});
