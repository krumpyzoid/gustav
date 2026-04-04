import { create } from 'zustand';
import { useEffect } from 'react';
import type { SessionEntry } from '../../main/domain/types';

interface AppStore {
  entries: SessionEntry[];
  repos: Map<string, string>;
  activeSession: string | null;
  setEntries: (entries: SessionEntry[]) => void;
  setRepos: (repos: [string, string][]) => void;
  setActiveSession: (session: string | null) => void;
}

export const useAppStore = create<AppStore>((set) => ({
  entries: [],
  repos: new Map(),
  activeSession: null,
  setEntries: (entries) => set({ entries }),
  setRepos: (repos) => set({ repos: new Map(repos) }),
  setActiveSession: (activeSession) => set({ activeSession }),
}));

export function useAppStateSubscription() {
  const { setEntries, setRepos } = useAppStore();

  useEffect(() => {
    // Initial fetch
    window.api.getState().then((state) => {
      setRepos(state.repos);
      setEntries(state.entries);

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
    });

    return cleanup;
  }, [setEntries, setRepos]);
}

export async function refreshState() {
  const state = await window.api.getState();
  useAppStore.getState().setRepos(state.repos);
  useAppStore.getState().setEntries(state.entries);
}
