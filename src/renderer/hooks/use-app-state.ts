import { create } from 'zustand';
import { useEffect } from 'react';
import type { WorkspaceAppState, WorkspaceState, WindowInfo } from '../../main/domain/types';
import { groupByWorkspace } from '../lib/group-by-workspace';
import { LocalTransport } from '../lib/transport/local-transport';
import type { SessionTransport } from '../lib/transport/session-transport';

const emptyWorkspace: WorkspaceState = {
  workspace: null,
  sessions: [],
  repoGroups: [],
  status: 'none',
};

export type RemoteConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

export type ForwardedPort = {
  remotePort: number;
  localPort: number;
  channelId: number;
};

interface AppStore {
  defaultWorkspace: WorkspaceState;
  workspaces: WorkspaceState[];
  activeSession: string | null;
  windows: WindowInfo[];
  // Remote state (the side panel renders local + remote in parallel,
  // independently of which transport is currently active for sessions).
  remoteState: WorkspaceAppState | null;
  remoteActiveSession: string | null;
  remoteConnectionStatus: RemoteConnectionStatus;
  forwardedPorts: ForwardedPort[];
  /**
   * The transport currently driving session I/O (PTY, lifecycle commands,
   * window operations). Always set; defaults to a `LocalTransport`.
   * Components and hooks dispatch through this — they no longer branch on
   * an `isRemoteSession` flag.
   */
  activeTransport: SessionTransport;
  setFromState: (state: WorkspaceAppState) => void;
  setActiveSession: (session: string | null) => void;
  setWindows: (windows: WindowInfo[]) => void;
  setRemoteState: (state: WorkspaceAppState | null) => void;
  setRemoteActiveSession: (session: string | null) => void;
  setRemoteConnectionStatus: (status: RemoteConnectionStatus) => void;
  setForwardedPorts: (ports: ForwardedPort[]) => void;
  /**
   * Swap the active transport. The previous transport's `detach()` is
   * called first so it can release listeners and tear down PTY channels.
   */
  setActiveTransport: (transport: SessionTransport) => void;
}

export const useAppStore = create<AppStore>((set, get) => ({
  defaultWorkspace: emptyWorkspace,
  workspaces: [],
  activeSession: null,
  windows: [],
  remoteState: null,
  remoteActiveSession: null,
  remoteConnectionStatus: 'disconnected',
  forwardedPorts: [],
  activeTransport: new LocalTransport(),
  setFromState: (state) => {
    const grouped = groupByWorkspace(state);
    // When a remote transport is active, the windows slice is owned by the
    // transport: it's last set by `RemoteGustavTransport.switchSession`
    // (via `setWindows`) and by `TabBar`'s optimistic updates. The local
    // 1Hz state poll has no knowledge of the remote-active session, so
    // applying its windows would clobber the correct remote windows.
    const isRemote = get().activeTransport.kind === 'remote';
    set({
      defaultWorkspace: grouped.defaultWorkspace,
      workspaces: grouped.workspaces,
      ...(isRemote ? {} : { windows: grouped.windows }),
    });
  },
  setActiveSession: (activeSession) => set({ activeSession }),
  setWindows: (windows) => set({ windows }),
  setRemoteState: (remoteState) => set({ remoteState }),
  setRemoteActiveSession: (remoteActiveSession) => set({ remoteActiveSession }),
  setRemoteConnectionStatus: (remoteConnectionStatus) => set({ remoteConnectionStatus }),
  setForwardedPorts: (forwardedPorts) => set({ forwardedPorts }),
  setActiveTransport: (transport) => {
    const previous = get().activeTransport;
    if (previous !== transport) previous.detach();
    set({ activeTransport: transport });
  },
}));

export function useAppStateSubscription() {
  const { setFromState, setWindows } = useAppStore();

  useEffect(() => {
    // Initial fetch — always local on startup. The renderer environment is
    // local; remote workspaces arrive as state pushes once a connection is
    // established.
    window.api.getState().then(async (state: WorkspaceAppState) => {
      setFromState(state);

      // Set initial active session — find first active session across all workspaces
      const allSessions = [
        ...state.defaultWorkspace.sessions,
        ...state.workspaces.flatMap((ws) => [
          ...ws.sessions,
          ...ws.repoGroups.flatMap((rg) => rg.sessions),
        ]),
      ];
      const first = allSessions.find((s) => s.tmuxSession);
      if (first?.tmuxSession) {
        useAppStore.getState().setActiveSession(first.tmuxSession);
        const result = await useAppStore.getState().activeTransport.switchSession(first.tmuxSession);
        if (result.success) {
          useAppStore.getState().setWindows(result.data);
        }
      }
    });

    // Subscribe to local state updates. We do not route this through the
    // active transport because the renderer always renders the local
    // workspace tree, regardless of which transport is currently driving
    // session I/O.
    const cleanupState = window.api.onStateUpdate((state: WorkspaceAppState) => {
      setFromState(state);
    });

    // Subscribe to remote state updates — feeds the RemoteSection sidebar
    // panel; runs in parallel to the local subscription.
    const cleanupRemote = window.api.onRemoteStateUpdate?.((state: WorkspaceAppState) => {
      useAppStore.getState().setRemoteState(state);
    });

    // Subscribe to remote connection status
    const cleanupStatus = window.api.onRemoteConnectionStatus?.((status: string) => {
      useAppStore.getState().setRemoteConnectionStatus(status as RemoteConnectionStatus);
    });

    return () => {
      cleanupState();
      cleanupRemote?.();
      cleanupStatus?.();
    };
  }, [setFromState, setWindows]);
}

export async function refreshState() {
  const state: WorkspaceAppState = await window.api.getState();
  useAppStore.getState().setFromState(state);
}
