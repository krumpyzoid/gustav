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
  ownsWindows: boolean;
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
  createWorkspaceSession: ReturnType<typeof vi.fn>;
  createRepoSession: ReturnType<typeof vi.fn>;
  createStandaloneSession: ReturnType<typeof vi.fn>;
  detach: ReturnType<typeof vi.fn>;
};

const remoteTransports: MockedTransport[] = [];
const localTransports: MockedTransport[] = [];
/** Queue of switchSession resolutions consumed FIFO by each new remote transport. */
const remoteTransportSwitchData: Array<{ success: boolean; data?: WindowInfo[]; error?: string }> = [];
/** Queue of wakeSession resolutions consumed FIFO by each new remote transport. */
const remoteTransportWakeData: Array<{ success: boolean; data?: WindowInfo[]; error?: string }> = [];
/** Queue of create*Session resolutions consumed FIFO by each new remote transport. */
const remoteTransportCreateData: Array<{ success: boolean; data?: string; error?: string }> = [];

function makeMockedTransport(kind: 'local' | 'remote'): MockedTransport {
  const armedSwitch = kind === 'remote' && remoteTransportSwitchData.length > 0
    ? remoteTransportSwitchData.shift()!
    : { success: true, data: [] };
  const armedWake = kind === 'remote' && remoteTransportWakeData.length > 0
    ? remoteTransportWakeData.shift()!
    : { success: true, data: [] };
  const armedCreate = kind === 'remote' && remoteTransportCreateData.length > 0
    ? remoteTransportCreateData.shift()!
    : { success: true, data: 'Dev/repo/_dir' };
  return {
    kind,
    ownsWindows: kind === 'remote',
    sendPtyInput: vi.fn(),
    sendPtyResize: vi.fn(),
    onPtyData: vi.fn(() => () => {}),
    getState: vi.fn(),
    onStateUpdate: vi.fn(() => () => {}),
    switchSession: vi.fn().mockResolvedValue(armedSwitch),
    sleepSession: vi.fn().mockResolvedValue({ success: true, data: undefined }),
    wakeSession: vi.fn().mockResolvedValue(armedWake),
    destroySession: vi.fn().mockResolvedValue({ success: true, data: undefined }),
    selectWindow: vi.fn(),
    newWindow: vi.fn(),
    killWindow: vi.fn(),
    setWindowOrder: vi.fn(),
    createWorkspaceSession: vi.fn().mockResolvedValue(armedCreate),
    createRepoSession: vi.fn().mockResolvedValue(armedCreate),
    createStandaloneSession: vi.fn().mockResolvedValue(armedCreate),
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

// Default to "no terminal mounted" so existing tests assert switchSession
// is called with `undefined`. Tests that need a specific size override this
// mock per-test via `vi.mocked(getTerminalSize).mockReturnValueOnce(...)`.
vi.mock('../../../hooks/use-terminal', () => ({
  getTerminalSize: vi.fn(() => null),
  focusTerminal: vi.fn(),
  requestTerminalFit: vi.fn(),
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
  createWorkspaceSession: vi.fn().mockResolvedValue({ success: true, data: 'Dev/scratch' }),
  launchWorktreeSession: vi.fn().mockResolvedValue({ success: true, data: 'Dev/repo/feat-x' }),
  createRepoSession: vi.fn().mockResolvedValue({ success: true, data: 'Dev/repo/_dir' }),
};

beforeEach(() => {
  remoteTransports.length = 0;
  localTransports.length = 0;
  remoteTransportSwitchData.length = 0;
  remoteTransportWakeData.length = 0;
  remoteTransportCreateData.length = 0;
  for (const fn of Object.values(api)) fn.mockReset?.();
  api.switchSession.mockResolvedValue({ success: true, data: [] });
  api.wakeSession.mockResolvedValue({ success: false });
  api.sleepSession.mockResolvedValue({ success: true });
  api.destroySession.mockResolvedValue({ success: true });
  api.createWorkspaceSession.mockResolvedValue({ success: true, data: 'Dev/scratch' });
  api.launchWorktreeSession.mockResolvedValue({ success: true, data: 'Dev/repo/feat-x' });
  api.createRepoSession.mockResolvedValue({ success: true, data: 'Dev/repo/_dir' });
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

    expect(persistent.switchSession).toHaveBeenCalledWith('ws/repo/_dir', undefined);
    expect(storeState.setActiveTransport).toHaveBeenCalledWith(persistent);
    expect(storeState.setWindows).toHaveBeenCalledWith(remoteWindows);
  });

  it('forwards the live terminal size to switchSession when a terminal is mounted', async () => {
    const { getTerminalSize } = await import('../../../hooks/use-terminal');
    vi.mocked(getTerminalSize).mockReturnValueOnce({ cols: 173, rows: 47 });

    const user = userEvent.setup();
    const remoteWindows: WindowInfo[] = [
      { index: 0, name: 'main', active: true },
    ];
    remoteTransportSwitchData.push({ success: true, data: remoteWindows });

    render(<SessionTab tab={makeTab()} isRemote />);
    await user.click(screen.getByRole('button', { name: /repo/i }));

    const persistent = remoteTransports[0];
    expect(persistent.switchSession).toHaveBeenCalledWith('ws/repo/_dir', { cols: 173, rows: 47 });
  });

  it('does NOT call requestTerminalFit imperatively after switchSession (hook drives the fit on transport change — #16)', async () => {
    const { requestTerminalFit } = await import('../../../hooks/use-terminal');
    vi.mocked(requestTerminalFit).mockClear();

    const user = userEvent.setup();
    const remoteWindows: WindowInfo[] = [{ index: 0, name: 'main', active: true }];
    remoteTransportSwitchData.push({ success: true, data: remoteWindows });

    render(<SessionTab tab={makeTab()} isRemote />);
    await user.click(screen.getByRole('button', { name: /repo/i }));

    // The hook owns post-swap fit now (use-terminal's [activeTransport]
    // effect). Calling requestTerminalFit() here would race React's commit
    // — the very bug #16 was filed to fix.
    expect(requestTerminalFit).not.toHaveBeenCalled();
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
    expect(attachTransport.switchSession).toHaveBeenCalledWith('ws/repo/_dir', undefined);
  });

  it('updates remoteActiveSession optimistically before the switchSession round-trip resolves', async () => {
    const user = userEvent.setup();
    let resolveSwitch!: (v: { success: boolean; data: WindowInfo[] }) => void;
    const pending = new Promise<{ success: boolean; data: WindowInfo[] }>((r) => { resolveSwitch = r; });
    remoteTransportSwitchData.push(pending as never);

    render(<SessionTab tab={makeTab()} isRemote />);

    // Awaiting user.click resolves once the handler has reached its first
    // suspension — the optimistic state writes happen synchronously before
    // `await switchSession`, so they should already be observable here even
    // though the round-trip hasn't resolved.
    await user.click(screen.getByRole('button', { name: /repo/i }));

    expect(storeState.setRemoteActiveSession).toHaveBeenCalledWith('ws/repo/_dir');
    expect(storeState.setWindows).toHaveBeenCalledWith([]);
    // The transport itself should NOT yet be installed — that happens
    // only on switchSession success.
    expect(storeState.setActiveTransport).not.toHaveBeenCalled();

    resolveSwitch({ success: true, data: [] });
  });

  it('rolls back the optimistic selection when switchSession fails', async () => {
    const user = userEvent.setup();
    storeState.activeSession = 'previous-local';
    storeState.remoteActiveSession = null;
    remoteTransportSwitchData.push({ success: false, error: 'attach failed' });

    render(<SessionTab tab={makeTab()} isRemote />);
    await user.click(screen.getByRole('button', { name: /repo/i }));

    // Optimistic update happened then was rolled back to the captured prior values.
    expect(storeState.setRemoteActiveSession).toHaveBeenCalledWith('ws/repo/_dir');
    expect(storeState.setRemoteActiveSession).toHaveBeenLastCalledWith(null);
    expect(storeState.setActiveSession).toHaveBeenLastCalledWith('previous-local');
    expect(storeState.setActiveTransport).not.toHaveBeenCalled();
  });

  it('latest-wins: a superseded click discards its result and the transport is detached', async () => {
    const user = userEvent.setup();

    // Stage TWO pending switchSession promises in order — first click gets
    // the slow one, second click resolves immediately.
    let resolveFirst!: (v: { success: boolean; data: WindowInfo[] }) => void;
    const slowFirst = new Promise<{ success: boolean; data: WindowInfo[] }>((r) => { resolveFirst = r; });
    remoteTransportSwitchData.push(slowFirst as never);
    remoteTransportSwitchData.push({ success: true, data: [{ index: 0, name: 'second', active: true }] } as never);

    render(<SessionTab tab={makeTab()} isRemote />);
    const button = screen.getByRole('button', { name: /repo/i });

    // Two clicks before the first round-trip resolves: latest wins.
    await user.click(button);
    await user.click(button);

    // Both transports were constructed (latest-wins doesn't drop the call).
    expect(remoteTransports.length).toBe(2);

    // The second click resolved synchronously and installed its transport.
    expect(storeState.setActiveTransport).toHaveBeenCalledTimes(1);
    expect(storeState.setActiveTransport).toHaveBeenCalledWith(remoteTransports[1]);

    // Now resolve the first click. Its handler must observe staleness,
    // detach its transport, and NOT replace the active transport.
    resolveFirst({ success: true, data: [] });
    await new Promise((r) => setTimeout(r, 0));

    expect(remoteTransports[0].detach).toHaveBeenCalled();
    // setActiveTransport still only called once — the stale result was discarded.
    expect(storeState.setActiveTransport).toHaveBeenCalledTimes(1);
  });

  it('does NOT install the transport when switchSession fails after a successful wake', async () => {
    const user = userEvent.setup();
    // First transport handles wake (success); second transport's switchSession fails.
    remoteTransportSwitchData.push({ success: true, data: [] }); // wakeSession's internal switch (none)
    remoteTransportSwitchData.push({ success: false, error: 'attach failed' });

    render(<SessionTab tab={makeTab({ active: false })} isRemote />);
    await user.click(screen.getByRole('button', { name: /repo/i }));

    // setActiveTransport must not be called when attach fails.
    expect(storeState.setActiveTransport).not.toHaveBeenCalled();
  });

  it('does NOT proceed to attach when the remote wake fails', async () => {
    const user = userEvent.setup();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // First-constructed remote transport's wakeSession resolves with failure.
    remoteTransportWakeData.push({ success: false, error: 'no persisted' });

    render(<SessionTab tab={makeTab({ active: false })} isRemote />);
    await user.click(screen.getByRole('button', { name: /repo/i }));

    // Exactly one transient transport for the wake — the attach was aborted.
    expect(remoteTransports.length).toBe(1);
    expect(remoteTransports[0].wakeSession).toHaveBeenCalledWith('ws/repo/_dir');
    expect(remoteTransports[0].switchSession).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
    expect(storeState.setActiveTransport).not.toHaveBeenCalled();

    errorSpy.mockRestore();
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

describe('SessionTab — remote click create-fallback after wake fails (#18)', () => {
  it('killed remote directory session: wake fails → createRepoSession is called on the remote transport', async () => {
    // Arm the wake to fail (consumed by transport 0, the wake transient)
    remoteTransportWakeData.push({ success: false, error: 'session not found' });
    // The mock constructor shifts one item per queue per `new`, so transport 0
    // (wake transient) eats the head of switchData even though it never calls
    // switchSession; transport 1 (the persistent attach transport) gets the
    // second entry. Push a placeholder + the meaningful response.
    remoteTransportSwitchData.push({ success: true, data: [] });
    const remoteWindows: WindowInfo[] = [{ index: 0, name: 'main', active: true }];
    remoteTransportSwitchData.push({ success: true, data: remoteWindows });

    const user = userEvent.setup();
    render(
      <SessionTab
        tab={makeTab({ active: false, type: 'directory' })}
        workspaceName="Dev"
        repoRoot="/srv/repo"
        isRemote
      />,
    );

    await user.click(screen.getByRole('button', { name: /repo/i }));

    // First transport is the wake-transient; on failure the click flow
    // should construct another transport and call createRepoSession on it.
    const calledCreate = remoteTransports.some((t) =>
      (t.createRepoSession as ReturnType<typeof vi.fn>).mock.calls.some(
        (c) => c[0] === 'Dev' && c[1] === '/srv/repo' && c[2] === 'directory',
      ),
    );
    expect(calledCreate).toBe(true);

    // After successful create, the persistent transport should be installed.
    expect(storeState.setRemoteActiveSession).toHaveBeenCalled();
    expect(storeState.setActiveTransport).toHaveBeenCalled();
    // The fresh-session window list (returned by switchSession on the persistent
    // transport) must be applied to the renderer's `windows` state.
    expect(storeState.setWindows).toHaveBeenCalledWith(remoteWindows);
  });

  it('killed remote session: when create itself fails after wake fails → no transport installed', async () => {
    // Wake fails → create is attempted → create itself fails. Both armed
    // through the queue so the wake transient (the first new transport)
    // returns failure for both wakeSession and createRepoSession.
    remoteTransportWakeData.push({ success: false, error: 'session not found' });
    remoteTransportCreateData.push({ success: false, error: 'remote create failed' });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const user = userEvent.setup();
    render(
      <SessionTab
        tab={makeTab({ active: false, type: 'directory' })}
        workspaceName="Dev"
        repoRoot="/srv/repo"
        isRemote
      />,
    );

    await user.click(screen.getByRole('button', { name: /repo/i }));

    // No persistent transport should be installed when the create call fails.
    expect(storeState.setActiveTransport).not.toHaveBeenCalled();
    expect(storeState.setRemoteActiveSession).not.toHaveBeenCalled();
    // The wake transient must have been detached cleanly.
    expect(remoteTransports[0].detach).toHaveBeenCalled();
    // The error is surfaced.
    const calls = errorSpy.mock.calls.map((c) => c.join(' '));
    expect(calls.some((line) => /remote create.*failed/i.test(line))).toBe(true);

    errorSpy.mockRestore();
  });

  it('killed remote worktree session: wake fails → createRepoSession with mode worktree + branch', async () => {
    remoteTransportWakeData.push({ success: false, error: 'session not found' });
    remoteTransportSwitchData.push({ success: true, data: [] });

    const user = userEvent.setup();
    render(
      <SessionTab
        tab={makeTab({
          active: false,
          type: 'worktree',
          branch: 'feat/x',
          worktreePath: '/srv/repo/.worktrees/feat-x',
          tmuxSession: 'Dev/repo/feat-x',
        })}
        workspaceName="Dev"
        repoRoot="/srv/repo"
        isRemote
      />,
    );

    await user.click(screen.getByRole('button', { name: /feat\/x/i }));

    const allCalls = remoteTransports.flatMap((t) =>
      (t.createRepoSession as ReturnType<typeof vi.fn>).mock.calls,
    );
    expect(allCalls.some((c) => c[0] === 'Dev' && c[1] === '/srv/repo' && c[2] === 'worktree' && c[3] === 'feat/x')).toBe(true);
  });

  it('killed remote workspace session: wake fails → createWorkspaceSession with extracted label', async () => {
    remoteTransportWakeData.push({ success: false, error: 'session not found' });
    remoteTransportSwitchData.push({ success: true, data: [] });

    const user = userEvent.setup();
    render(
      <SessionTab
        tab={makeTab({
          active: false,
          type: 'workspace',
          tmuxSession: 'Dev/scratch',
          repoName: null,
        })}
        workspaceName="Dev"
        workspaceDir="/srv/dev"
        isRemote
      />,
    );

    await user.click(screen.getByRole('button', { name: /scratch/i }));

    const allCalls = remoteTransports.flatMap((t) =>
      (t.createWorkspaceSession as ReturnType<typeof vi.fn>).mock.calls,
    );
    expect(allCalls.some((c) => c[0] === 'Dev' && c[1] === '/srv/dev' && c[2] === 'scratch')).toBe(true);
  });

  it('remote directory tab missing repoRoot → console.error, no create, no transport installed', async () => {
    remoteTransportWakeData.push({ success: false, error: 'session not found' });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const user = userEvent.setup();
    render(
      <SessionTab
        tab={makeTab({ active: false, type: 'directory' })}
        workspaceName="Dev"
        // repoRoot intentionally omitted
        isRemote
      />,
    );

    await user.click(screen.getByRole('button', { name: /repo/i }));

    // No create call on any transport.
    for (const t of remoteTransports) {
      expect(t.createRepoSession).not.toHaveBeenCalled();
      expect(t.createWorkspaceSession).not.toHaveBeenCalled();
    }
    expect(storeState.setActiveTransport).not.toHaveBeenCalled();
    const calls = errorSpy.mock.calls.map((c) => c.join(' '));
    expect(calls.some((line) => /repoRoot/.test(line))).toBe(true);

    errorSpy.mockRestore();
  });
});

describe('SessionTab — local click create-fallback after wake fails (#18)', () => {
  it('clicks a directory tab whose wake fails → calls createRepoSession', async () => {
    api.wakeSession.mockResolvedValue({ success: false });
    api.createRepoSession.mockResolvedValue({ success: true, data: 'Dev/repo/_dir' });

    const user = userEvent.setup();
    render(
      <SessionTab
        tab={makeTab({ active: false, type: 'directory' })}
        workspaceName="Dev"
        repoRoot="/srv/repo"
      />,
    );

    await user.click(screen.getByRole('button', { name: /repo/i }));

    expect(api.wakeSession).toHaveBeenCalled();
    expect(api.createRepoSession).toHaveBeenCalledWith('Dev', '/srv/repo', 'directory');
  });

  it('clicks a worktree tab whose wake fails → calls launchWorktreeSession', async () => {
    api.wakeSession.mockResolvedValue({ success: false });
    api.launchWorktreeSession.mockResolvedValue({ success: true, data: 'Dev/repo/feat-x' });

    const user = userEvent.setup();
    render(
      <SessionTab
        tab={makeTab({
          active: false,
          type: 'worktree',
          branch: 'feat/x',
          worktreePath: '/srv/repo/.worktrees/feat-x',
        })}
        workspaceName="Dev"
        repoRoot="/srv/repo"
      />,
    );

    await user.click(screen.getByRole('button', { name: /feat\/x/i }));

    expect(api.launchWorktreeSession).toHaveBeenCalledWith(
      'Dev',
      '/srv/repo',
      'feat/x',
      '/srv/repo/.worktrees/feat-x',
    );
  });

  it('clicks a workspace tab whose wake fails → calls createWorkspaceSession with extracted label', async () => {
    api.wakeSession.mockResolvedValue({ success: false });
    api.createWorkspaceSession.mockResolvedValue({ success: true, data: 'Dev/scratch' });

    const user = userEvent.setup();
    render(
      <SessionTab
        tab={makeTab({
          active: false,
          type: 'workspace',
          tmuxSession: 'Dev/scratch',
          repoName: null,
        })}
        workspaceName="Dev"
        workspaceDir="/srv/dev"
      />,
    );

    await user.click(screen.getByRole('button', { name: /scratch/i }));

    expect(api.createWorkspaceSession).toHaveBeenCalledWith('Dev', '/srv/dev', 'scratch');
  });

  it('directory tab missing repoRoot → surfaces a console.error instead of silently no-op-ing', async () => {
    api.wakeSession.mockResolvedValue({ success: false });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const user = userEvent.setup();
    render(
      <SessionTab
        tab={makeTab({ active: false, type: 'directory' })}
        workspaceName="Dev"
        // repoRoot intentionally omitted
      />,
    );

    await user.click(screen.getByRole('button', { name: /repo/i }));

    expect(api.createRepoSession).not.toHaveBeenCalled();
    // Look for an error mentioning the missing prop, not a silent no-op.
    const calls = errorSpy.mock.calls.map((c) => c.join(' '));
    expect(calls.some((line) => /repoRoot/.test(line))).toBe(true);

    errorSpy.mockRestore();
  });
});
