// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { WindowInfo } from '../../../../main/domain/types';
import type { SessionTransport } from '../../../lib/transport/session-transport';

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

// LocalTransport is constructed inside the component when closing the last
// remote tab. The test replaces it with a fake so we can observe the swap
// without pulling in the real implementation's `window.api` dependencies.
const localTransportInstances: FakeTransport[] = [];
vi.mock('../../../lib/transport/local-transport', () => ({
  LocalTransport: class {
    kind = 'local' as const;
    sendPtyInput = vi.fn();
    sendPtyResize = vi.fn();
    onPtyData = vi.fn(() => () => {});
    getState = vi.fn();
    onStateUpdate = vi.fn(() => () => {});
    switchSession = vi.fn();
    sleepSession = vi.fn();
    wakeSession = vi.fn();
    destroySession = vi.fn();
    selectWindow = vi.fn();
    newWindow = vi.fn();
    killWindow = vi.fn();
    setWindowOrder = vi.fn();
    detach = vi.fn();
    constructor() { localTransportInstances.push(this as unknown as FakeTransport); }
  },
}));

// Reusable fake transport — exposed via the store so the component dispatches
// through it instead of `window.api`.
type FakeTransport = {
  kind: 'local' | 'remote';
  sendPtyInput: ReturnType<typeof vi.fn>;
  sendPtyResize: ReturnType<typeof vi.fn>;
  onPtyData: ReturnType<typeof vi.fn>;
  getState: ReturnType<typeof vi.fn>;
  onStateUpdate: ReturnType<typeof vi.fn>;
  switchSession: ReturnType<typeof vi.fn>;
  sleepSession: ReturnType<typeof vi.fn>;
  wakeSession: ReturnType<typeof vi.fn>;
  destroySession: ReturnType<typeof vi.fn>;
  selectWindow: ReturnType<typeof vi.fn>;
  newWindow: ReturnType<typeof vi.fn>;
  killWindow: ReturnType<typeof vi.fn>;
  setWindowOrder: ReturnType<typeof vi.fn>;
  detach: ReturnType<typeof vi.fn>;
};

function makeFakeTransport(kind: 'local' | 'remote'): FakeTransport {
  return {
    kind,
    sendPtyInput: vi.fn(),
    sendPtyResize: vi.fn(),
    onPtyData: vi.fn(() => () => {}),
    getState: vi.fn(),
    onStateUpdate: vi.fn(() => () => {}),
    switchSession: vi.fn().mockResolvedValue({ success: true, data: [] }),
    sleepSession: vi.fn().mockResolvedValue({ success: true, data: undefined }),
    wakeSession: vi.fn().mockResolvedValue({ success: true, data: [] }),
    destroySession: vi.fn().mockResolvedValue({ success: true, data: undefined }),
    selectWindow: vi.fn().mockResolvedValue({ success: true, data: undefined }),
    newWindow: vi.fn().mockResolvedValue({ success: true, data: undefined }),
    killWindow: vi.fn().mockResolvedValue({ success: true, data: undefined }),
    setWindowOrder: vi.fn().mockResolvedValue({ success: true, data: undefined }),
    detach: vi.fn(),
  };
}

let storeState: {
  windows: WindowInfo[];
  activeSession: string | null;
  remoteActiveSession: string | null;
  activeTransport: FakeTransport;
  setWindows: (w: WindowInfo[]) => void;
  setActiveSession: (s: string | null) => void;
  setRemoteActiveSession: (s: string | null) => void;
  setActiveTransport: (t: SessionTransport) => void;
};

vi.mock('../../../hooks/use-app-state', () => ({
  useAppStore: () => storeState,
}));

beforeEach(() => {
  for (const k of Object.keys(sortableProps)) delete sortableProps[k];
  focusTerminal.mockReset();
  localTransportInstances.length = 0;
  storeState = {
    windows: [
      { index: 0, name: 'Editor', active: false },
      { index: 1, name: 'Logs', active: true },
      { index: 2, name: 'Tests', active: false },
    ],
    activeSession: 'Dev/_ws',
    remoteActiveSession: null,
    activeTransport: makeFakeTransport('local'),
    setWindows: vi.fn((w) => {
      storeState.windows = w;
    }),
    setActiveSession: vi.fn(),
    setRemoteActiveSession: vi.fn(),
    setActiveTransport: vi.fn(),
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

  it('reorders windows and persists via the active transport when SortableItem fires onReorder', async () => {
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
    expect(storeState.activeTransport.setWindowOrder).toHaveBeenCalledWith(
      'Dev/_ws',
      ['Editor', 'Tests', 'Logs'],
    );
  });

  it('reorders below the target when edge is "bottom"', () => {
    render(<TabBar />);

    // Drag "Editor" below "Tests" → ['Logs','Tests','Editor']
    sortableProps['Editor'].onReorder('Editor', 'Tests', 'bottom');

    const next = (storeState.setWindows as ReturnType<typeof vi.fn>).mock.calls[0][0] as WindowInfo[];
    expect(next.map((w) => w.name)).toEqual(['Logs', 'Tests', 'Editor']);
  });

  it('clicking a tab calls the active transport selectWindow', async () => {
    render(<TabBar />);

    await userEvent.click(screen.getByRole('button', { name: /editor/i }));

    expect(storeState.activeTransport.selectWindow).toHaveBeenCalledWith('Dev/_ws', 'Editor');
    expect(storeState.activeTransport.setWindowOrder).not.toHaveBeenCalled();
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

    expect(storeState.activeTransport.newWindow).toHaveBeenCalledWith('Dev/_ws', 'Notes');
    expect(focusTerminal).toHaveBeenCalledOnce();
  });

  it('does not focus the terminal when handleAdd early-returns on empty input', async () => {
    render(<TabBar />);

    await userEvent.click(screen.getByRole('button', { name: '+' }));
    const input = screen.getByPlaceholderText(/tab name/i) as HTMLInputElement;
    await userEvent.type(input, '   {Enter}');

    expect(storeState.activeTransport.newWindow).not.toHaveBeenCalled();
    expect(focusTerminal).not.toHaveBeenCalled();
  });
});

describe('TabBar — remote session routing', () => {
  beforeEach(() => {
    // Switch the store into "remote mode": no local active session, a
    // remote session set, and a remote-kind active transport.
    storeState.activeSession = null;
    storeState.remoteActiveSession = 'Dev/_ws';
    storeState.activeTransport = makeFakeTransport('remote');
  });

  it('still renders one tab per window when in remote mode', () => {
    render(<TabBar />);
    expect(screen.getByRole('button', { name: /editor/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /logs/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /tests/i })).toBeInTheDocument();
  });

  it('clicking a tab dispatches selectWindow on the remote transport', async () => {
    render(<TabBar />);

    await userEvent.click(screen.getByRole('button', { name: /editor/i }));

    expect(storeState.activeTransport.selectWindow).toHaveBeenCalledWith('Dev/_ws', 'Editor');
  });

  it('adding a new tab dispatches newWindow on the remote transport', async () => {
    render(<TabBar />);

    await userEvent.click(screen.getByRole('button', { name: '+' }));
    const input = screen.getByPlaceholderText(/tab name/i) as HTMLInputElement;
    await userEvent.type(input, 'Notes{Enter}');

    expect(storeState.activeTransport.newWindow).toHaveBeenCalledWith('Dev/_ws', 'Notes');
  });

  it('reordering dispatches setWindowOrder on the remote transport', async () => {
    render(<TabBar />);

    sortableProps['Tests'].onReorder('Tests', 'Logs', 'top');
    await Promise.resolve();

    expect(storeState.activeTransport.setWindowOrder).toHaveBeenCalledWith(
      'Dev/_ws',
      ['Editor', 'Tests', 'Logs'],
    );
  });

  it('closing a non-last tab dispatches killWindow on the remote transport', async () => {
    render(<TabBar />);

    // Hover-only "×" — find the close span inside the Editor tab and click it.
    const editorBtn = screen.getByRole('button', { name: /editor/i });
    const closeBtn = editorBtn.querySelector('span') as HTMLElement;
    await userEvent.click(closeBtn);

    expect(storeState.activeTransport.killWindow).toHaveBeenCalledWith('Dev/_ws', 0);
  });

  it('uses the remote session name in the SortableItem scope', () => {
    render(<TabBar />);
    expect(sortableProps['Editor'].scope).toBe('window-tabs:Dev/_ws');
  });

  it('closing the last tab sleeps via the remote transport, swaps in a local transport, and clears the remote session', async () => {
    storeState.windows = [{ index: 0, name: 'Editor', active: true }];

    render(<TabBar />);
    const editorBtn = screen.getByRole('button', { name: /editor/i });
    const closeBtn = editorBtn.querySelector('span') as HTMLElement;
    await userEvent.click(closeBtn);

    expect(storeState.activeTransport.sleepSession).toHaveBeenCalledWith('Dev/_ws');
    expect(storeState.setActiveSession).toHaveBeenCalledWith(null);
    expect(storeState.setRemoteActiveSession).toHaveBeenCalledWith(null);

    // A fresh LocalTransport replaces the remote one — the store sees the swap.
    expect(localTransportInstances.length).toBe(1);
    expect(storeState.setActiveTransport).toHaveBeenCalledWith(localTransportInstances[0]);
  });
});
