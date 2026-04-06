import { create } from 'zustand';
import { useEffect } from 'react';
import type { SessionEntry, WindowInfo } from '../../main/domain/types';

interface AppStore {
  entries: SessionEntry[];
  repos: Map<string, string>;
  activeSession: string | null;
  windows: WindowInfo[];
  setEntries: (entries: SessionEntry[]) => void;
  setRepos: (repos: [string, string][]) => void;
  setActiveSession: (session: string | null) => void;
  setWindows: (windows: WindowInfo[]) => void;
}

export const useAppStore = create<AppStore>((set) => ({
  entries: [],
  repos: new Map(),
  activeSession: null,
  windows: [],
  setEntries: (entries) => set({ entries }),
  setRepos: (repos) => set({ repos: new Map(repos) }),
  setActiveSession: (activeSession) => set({ activeSession }),
  setWindows: (windows) => set({ windows }),
}));

export function useAppStateSubscription() {
  const { setEntries, setRepos, setWindows } = useAppStore();

  useEffect(() => {
    // Initial fetch
    window.api.getState().then((state) => {
      setRepos(state.repos);
      setEntries(state.entries);
      setWindows(state.windows ?? []);

      // Set initial active session
      const first = state.entries.find((e) => e.tmuxSession && e.repo !== 'standalone');
      if (first?.tmuxSession) {
        useAppStore.getState().setActiveSession(first.tmuxSession);
      }
    });

    // Subscribe to updates
    const cleanup = window.api.onStateUpdate((state) => {
      setRepos(state.repos);
      setEntries(state.entries);
      setWindows(state.windows ?? []);
    });

    return cleanup;
  }, [setEntries, setRepos, setWindows]);
}

export async function refreshState() {
  const state = await window.api.getState();
  useAppStore.getState().setRepos(state.repos);
  useAppStore.getState().setEntries(state.entries);
  useAppStore.getState().setWindows(state.windows ?? []);
}
