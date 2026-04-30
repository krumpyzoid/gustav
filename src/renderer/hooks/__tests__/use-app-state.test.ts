// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../use-app-state';
import { LocalTransport } from '../../lib/transport/local-transport';
import { RemoteGustavTransport } from '../../lib/transport/remote-transport';
import type { WorkspaceAppState, WindowInfo } from '../../../main/domain/types';

const emptyState: WorkspaceAppState = {
  defaultWorkspace: { workspace: null, sessions: [], repoGroups: [], status: 'none' },
  workspaces: [],
  windows: [],
};

const stateWithWindows = (windows: WindowInfo[]): WorkspaceAppState => ({
  ...emptyState,
  windows,
});

beforeEach(() => {
  // Stub window.api so LocalTransport's lazy supervisor calls don't blow up.
  // @ts-expect-error — partial api for tests
  globalThis.window.api = {};
  useAppStore.setState({
    defaultWorkspace: emptyState.defaultWorkspace,
    workspaces: [],
    activeSession: null,
    windows: [],
    remoteState: null,
    remoteActiveSession: null,
    remoteConnectionStatus: 'disconnected',
    forwardedPorts: [],
    activeTransport: new LocalTransport(),
  });
});

describe('useAppStore.setFromState', () => {
  it('updates the windows slice when active transport is local', () => {
    useAppStore.getState().setActiveTransport(new LocalTransport());
    const wins: WindowInfo[] = [{ index: 0, name: 'shell', active: true }];

    useAppStore.getState().setFromState(stateWithWindows(wins));

    expect(useAppStore.getState().windows).toEqual(wins);
  });

  it('does NOT overwrite the windows slice when active transport is remote', () => {
    const remoteWindows: WindowInfo[] = [
      { index: 0, name: 'shell', active: false },
      { index: 1, name: 'editor', active: true },
    ];
    useAppStore.setState({
      activeTransport: new RemoteGustavTransport(),
      windows: remoteWindows,
    });

    // Local poller pushes empty windows (its activeSession is null while
    // we're on a remote session).
    useAppStore.getState().setFromState(stateWithWindows([]));

    expect(useAppStore.getState().windows).toEqual(remoteWindows);
  });

  it('preserves the latest remote session windows across an interleaved local push', () => {
    useAppStore.setState({ activeTransport: new RemoteGustavTransport() });

    const aWindows: WindowInfo[] = [
      { index: 0, name: 'shell', active: true },
      { index: 1, name: 'logs', active: false },
    ];
    const bWindows: WindowInfo[] = [
      { index: 0, name: 'shell', active: true },
      { index: 1, name: 'editor', active: false },
      { index: 2, name: 'tests', active: false },
    ];

    // Switch to remote session A.
    useAppStore.getState().setWindows(aWindows);
    // Switch to remote session B.
    useAppStore.getState().setWindows(bWindows);
    // Local 1Hz poll fires with stale/empty windows.
    useAppStore.getState().setFromState(stateWithWindows([]));

    expect(useAppStore.getState().windows).toEqual(bWindows);
  });

  it('still updates workspaces and defaultWorkspace when remote (only windows is preserved)', () => {
    useAppStore.setState({ activeTransport: new RemoteGustavTransport() });
    const newDefault = { workspace: null, sessions: [], repoGroups: [], status: 'done' as const };
    const before = useAppStore.getState().windows;

    useAppStore.getState().setFromState({
      defaultWorkspace: newDefault,
      workspaces: [],
      windows: [{ index: 9, name: 'should-not-apply', active: true }],
    });

    expect(useAppStore.getState().defaultWorkspace).toEqual(newDefault);
    expect(useAppStore.getState().windows).toEqual(before);
  });
});
