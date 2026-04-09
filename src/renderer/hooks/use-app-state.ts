import { create } from 'zustand';
import { useEffect } from 'react';
import type { WorkspaceAppState, WorkspaceState, WindowInfo } from '../../main/domain/types';
import { groupByWorkspace } from '../lib/group-by-workspace';

const emptyWorkspace: WorkspaceState = {
  workspace: null,
  sessions: [],
  repoGroups: [],
  status: 'none',
};

interface AppStore {
  defaultWorkspace: WorkspaceState;
  workspaces: WorkspaceState[];
  activeSession: string | null;
  windows: WindowInfo[];
  setFromState: (state: WorkspaceAppState) => void;
  setActiveSession: (session: string | null) => void;
  setWindows: (windows: WindowInfo[]) => void;
}

export const useAppStore = create<AppStore>((set) => ({
  defaultWorkspace: emptyWorkspace,
  workspaces: [],
  activeSession: null,
  windows: [],
  setFromState: (state) => {
    const grouped = groupByWorkspace(state);
    set({
      defaultWorkspace: grouped.defaultWorkspace,
      workspaces: grouped.workspaces,
      windows: grouped.windows,
    });
  },
  setActiveSession: (activeSession) => set({ activeSession }),
  setWindows: (windows) => set({ windows }),
}));

export function useAppStateSubscription() {
  const { setFromState, setWindows } = useAppStore();

  useEffect(() => {
    // Initial fetch
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
        const result = await window.api.switchSession(first.tmuxSession);
        if (result.success) {
          useAppStore.getState().setWindows(result.data);
        }
      }
    });

    // Subscribe to updates
    const cleanup = window.api.onStateUpdate((state: WorkspaceAppState) => {
      setFromState(state);
    });

    return cleanup;
  }, [setFromState, setWindows]);
}

export async function refreshState() {
  const state: WorkspaceAppState = await window.api.getState();
  useAppStore.getState().setFromState(state);
}
