import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
  // PTY
  onPtyData: (cb: (data: string) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, data: string) => cb(data);
    ipcRenderer.on('pty-data', handler);
    return () => ipcRenderer.removeListener('pty-data', handler);
  },
  sendPtyInput: (data: string) => ipcRenderer.send('pty-input', data),
  sendPtyResize: (cols: number, rows: number) => ipcRenderer.send('pty-resize', { cols, rows }),

  // State
  getState: () => ipcRenderer.invoke('get-state'),
  onStateUpdate: (cb: (state: any) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, state: any) => cb(state);
    ipcRenderer.on('state-update', handler);
    return () => ipcRenderer.removeListener('state-update', handler);
  },

  // Actions
  switchSession: (session: string) => ipcRenderer.invoke('switch-session', session),
  killSession: (session: string) => ipcRenderer.invoke('kill-session', session),
  createSession: (name: string) => ipcRenderer.invoke('create-session', name),
  startSession: (session: string, workdir: string) => ipcRenderer.invoke('start-session', session, workdir),
  createWorktree: (params: any) => ipcRenderer.invoke('create-worktree', params),
  removeWorktree: (repoRoot: string, branch: string, deleteBranch: boolean) =>
    ipcRenderer.invoke('remove-worktree', repoRoot, branch, deleteBranch),
  cleanWorktrees: (items: any[]) => ipcRenderer.invoke('clean-worktrees', items),
  pinProjects: () => ipcRenderer.invoke('pin-projects'),
  unpinProject: (repoName: string) => ipcRenderer.invoke('unpin-project', repoName),
  selectWindow: (session: string, window: string) => ipcRenderer.invoke('select-window', session, window),
  getBranches: (repoRoot: string) => ipcRenderer.invoke('get-branches', repoRoot),
  getCleanCandidates: () => ipcRenderer.invoke('get-clean-candidates'),

  // Theme
  getTheme: () => ipcRenderer.invoke('get-theme'),
  onThemeUpdate: (cb: (colors: any) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, colors: any) => cb(colors);
    ipcRenderer.on('theme-update', handler);
    return () => ipcRenderer.removeListener('theme-update', handler);
  },
});
