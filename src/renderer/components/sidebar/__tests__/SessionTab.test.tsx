// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SessionTab as SessionTabType, WindowInfo } from '../../../../main/domain/types';
import type { SessionTransport } from '../../../lib/transport/session-transport';

// ── Transport mocks ──────────────────────────────────────────────
//
// SessionTab constructs transports for two purposes:
//   1) The persistent remote transport that drives PTY I/O after a click —
//      surfaced through `setActiveTransport`.
//   2) Transient one-shots for sleep/destroy commands.
//
// We replace both modules with classes that record their instances so the
// test can drive their methods and assert which transport was used.

type MockedTransport = {
  kind: 'local' | 'remote';
  sendPtyInput: ReturnType<typeof vi.fn>;
  sendPtyResize: ReturnType<typeof vi.fn>;
  onPtyData: ReturnType<typeof vi.fn>;
  getState: ReturnType<typeof vi.fn>;
  onStateUpdate: ReturnType<typeof vi.fn>;
  switchSession: ReturnType<typeof vi.fn>;
  wakeSession: ReturnType<typeof vi.fn>;
  sleepSession: ReturnType<typeof vi.fn>;
  destroySession: ReturnType<typeof vi.fn>;
  selectWindow: ReturnType<typeof vi.fn>;
  newWindow: ReturnType<typeof vi.fn>;
  killWindow: ReturnType<typeof vi.fn>;
  setWindowOrder: ReturnType<typeof vi.fn>;
  detach: ReturnType<typeof vi.fn>;
};

const remoteTransports: MockedTransport[] = [];
const localTransports: MockedTransport[] = [];
/** Queue of switchSession resolutions consumed FIFO by each new remote transport. */
const remoteTransportSwitchData: Array<{ success: boolean; data?: WindowInfo[]; error?: string }> = [];

function makeMockedTransport(kind: 'local' | 'remote'): MockedTransport {
  const armed = kind === 'remote' && remoteTransportSwitchData.length > 0
    ? remoteTransportSwitchData.shift()!
    : { success: true, data: [] };
  return {
    kind,
    sendPtyInput: vi.fn(),
    sendPtyResize: vi.fn(),
    onPtyData: vi.fn(() => () => {}),
    getState: vi.fn(),
    onStateUpdate: vi.fn(() => () => {}),
    switchSession: vi.fn().mockResolvedValue(armed),
    sleepSession: vi.fn().mockResolvedValue({ success: true, data: undefined }),
    wakeSession: vi.fn().mockResolvedValue({ success: true, data: [] }),
    destroySession: vi.fn().mockResolvedValue({ success: true, data: undefined }),
    selectWindow: vi.fn(),
    newWindow: vi.fn(),
    killWindow: vi.fn(),
    setWindowOrder: vi.fn(),
    detach: vi.fn(),
  };
}

function MockRemoteTransport(this: MockedTransport) {
  Object.assign(this, makeMockedTransport('remote'));
  remoteTransports.push(this);
}

function MockLocalTransport(this: MockedTransport) {
  Object.assign(this, makeMockedTransport('local'));
  localTransports.push(this);
}

vi.mock('../../../lib/transport/remote-transport', () => ({
  RemoteGustavTransport: MockRemoteTransport,
}));

vi.mock('../../../lib/transport/local-transport', () => ({
  LocalTransport: MockLocalTransport,
}));

// ── Store mock ────────────────────────────────────────────────────

type StoreState = {
  activeSession: string | null;
  remoteActiveSession: string | null;
  setActiveSession: (s: string | null) => void;
  setWindows: (w: WindowInfo[]) => void;
  setRemoteActiveSession: (s: string | null) => void;
  setActiveTransport: (t: SessionTransport) => void;
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
  sleepSession: vi.fn().mockResolvedValue({ success: true }),
  destroySession: vi.fn().mockResolvedValue({ success: true }),
};

beforeEach(() => {
  remoteTransports.length = 0;
  localTransports.length = 0;
  remoteTransportSwitchData.length = 0;
  for (const fn of Object.values(api)) fn.mockReset?.();
  api.switchSession.mockResolvedValue({ success: true, data: [] });
  api.wakeSession.mockResolvedValue({ success: false });
  api.sleepSession.mockResolvedValue({ success: true });
  api.destroySession.mockResolvedValue({ success: true });
  // @ts-expect-error — partial window.api for tests
  globalThis.window.api = api;
  storeState = {
    activeSession: null,
    remoteActiveSession: null,
    setActiveSession: vi.fn((s) => { storeState.activeSession = s; }),
    setWindows: vi.fn(),
    setRemoteActiveSession: vi.fn((s) => { storeState.remoteActiveSession = s; }),
    setActiveTransport: vi.fn(),
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
  it('routes attach + window-list through a fresh RemoteGustavTransport and installs it as the active transport', async () => {
    const user = userEvent.setup();
    const remoteWindows: WindowInfo[] = [
      { index: 0, name: 'Editor', active: true },
      { index: 1, name: 'Logs', active: false },
    ];

    // The component constructs the transport on click. Bind a one-shot
    // resolver into the `remoteTransportSwitchData` queue: each new remote
    // transport's `switchSession` shifts off the head if non-empty.
    remoteTransportSwitchData.push({ success: true, data: remoteWindows });

    render(<SessionTab tab={makeTab()} isRemote />);

    await user.click(screen.getByRole('button', { name: /repo/i }));

    // Active session means no wake transient — exactly one remote transport.
    expect(remoteTransports.length).toBe(1);
    const persistent = remoteTransports[0];

    expect(persistent.switchSession).toHaveBeenCalledWith('ws/repo/_dir');
    expect(storeState.setActiveTransport).toHaveBeenCalledWith(persistent);
    expect(storeState.setWindows).toHaveBeenCalledWith(remoteWindows);
  });

  it('wakes an inactive remote session via a transient transport before attaching', async () => {
    const user = userEvent.setup();
    render(<SessionTab tab={makeTab({ active: false })} isRemote />);

    await user.click(screen.getByRole('button', { name: /repo/i }));

    // Two remote transports get constructed: one transient for the wake,
    // one persistent for the attach.
    expect(remoteTransports.length).toBe(2);
    const [wakeTransport, attachTransport] = remoteTransports;
    expect(wakeTransport.wakeSession).toHaveBeenCalledWith('ws/repo/_dir');
    expect(attachTransport.switchSession).toHaveBeenCalledWith('ws/repo/_dir');
  });
});

describe('SessionTab — sleep / destroy command routing', () => {
  it('routes sleep through a transient RemoteGustavTransport when isRemote', async () => {
    const user = userEvent.setup();
    render(<SessionTab tab={makeTab()} isRemote />);

    // The sleep button only renders on hover; query within the action group.
    const moonButton = screen.getByTitle(/put to sleep/i);
    await user.click(moonButton);

    expect(remoteTransports.length).toBe(1);
    expect(remoteTransports[0].sleepSession).toHaveBeenCalledWith('ws/repo/_dir');
    expect(localTransports.length).toBe(0);
  });

  it('routes sleep through a transient LocalTransport when not isRemote', async () => {
    const user = userEvent.setup();
    render(<SessionTab tab={makeTab()} />);

    const moonButton = screen.getByTitle(/put to sleep/i);
    await user.click(moonButton);

    expect(localTransports.length).toBe(1);
    expect(localTransports[0].sleepSession).toHaveBeenCalledWith('ws/repo/_dir');
    expect(remoteTransports.length).toBe(0);
  });

  it('routes destroy through a transient RemoteGustavTransport when isRemote', async () => {
    const user = userEvent.setup();
    render(<SessionTab tab={makeTab()} isRemote />);

    const trashButton = screen.getByTitle(/destroy session/i);
    await user.click(trashButton);

    expect(remoteTransports.length).toBe(1);
    expect(remoteTransports[0].destroySession).toHaveBeenCalledWith('ws/repo/_dir');
  });
});
