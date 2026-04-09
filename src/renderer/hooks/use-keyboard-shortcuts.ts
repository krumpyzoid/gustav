import { useEffect } from 'react';
import { useAppStore } from './use-app-state';
import type { WindowInfo, WorkspaceState } from '../../main/domain/types';

/** Flatten all sessions from the sidebar in visual order. */
function flatSessionOrder(defaultWorkspace: WorkspaceState, workspaces: WorkspaceState[]): string[] {
  const result: string[] = [];

  function addWorkspace(ws: WorkspaceState) {
    for (const s of ws.sessions) result.push(s.tmuxSession);
    for (const rg of ws.repoGroups) {
      for (const s of rg.sessions) result.push(s.tmuxSession);
    }
  }

  addWorkspace(defaultWorkspace);
  for (const ws of workspaces) addWorkspace(ws);

  return result;
}

async function switchToSession(tmuxSession: string) {
  const { setActiveSession, setWindows } = useAppStore.getState();
  setActiveSession(tmuxSession);
  const result = await window.api.switchSession(tmuxSession);
  if (result.success) setWindows(result.data as WindowInfo[]);
}

async function switchToWindow(windowName: string) {
  const { activeSession, windows, setWindows } = useAppStore.getState();
  if (!activeSession) return;
  setWindows(windows.map((w) => ({ ...w, active: w.name === windowName })));
  await window.api.selectWindow(activeSession, windowName);
}

export function navigateSession(delta: 1 | -1) {
  const { defaultWorkspace, workspaces, activeSession } = useAppStore.getState();
  const order = flatSessionOrder(defaultWorkspace, workspaces);
  if (order.length <= 1) return;
  const idx = activeSession ? order.indexOf(activeSession) : -1;
  const next = order[(idx + delta + order.length) % order.length];
  switchToSession(next);
}

export function navigateWindow(delta: 1 | -1) {
  const { windows } = useAppStore.getState();
  if (windows.length <= 1) return;
  const activeIdx = windows.findIndex((w) => w.active);
  const next = windows[(activeIdx + delta + windows.length) % windows.length];
  switchToWindow(next.name);
}

/** Handle Alt+Arrow shortcuts when focus is outside the terminal. */
export function useKeyboardShortcuts() {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (!e.altKey) return;
      switch (e.key) {
        case 'ArrowDown':  e.preventDefault(); navigateSession(1); break;
        case 'ArrowUp':    e.preventDefault(); navigateSession(-1); break;
        case 'ArrowRight': e.preventDefault(); navigateWindow(1); break;
        case 'ArrowLeft':  e.preventDefault(); navigateWindow(-1); break;
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);
}
