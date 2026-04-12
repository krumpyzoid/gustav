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

  // Workspace
  createWorkspace: (name: string, directory: string) => ipcRenderer.invoke('create-workspace', name, directory),
  renameWorkspace: (id: string, newName: string) => ipcRenderer.invoke('rename-workspace', id, newName),
  removeWorkspace: (id: string) => ipcRenderer.invoke('remove-workspace', id),
  reorderWorkspaces: (ids: string[]) => ipcRenderer.invoke('reorder-workspaces', ids),
  reorderWithinWorkspace: (workspaceId: string, ordering: Record<string, unknown>) =>
    ipcRenderer.invoke('reorder-within-workspace', workspaceId, ordering),
  discoverRepos: (directory: string) => ipcRenderer.invoke('discover-repos', directory),
  pinRepos: (workspaceId: string, repoPaths: string[]) => ipcRenderer.invoke('pin-repos', workspaceId, repoPaths),
  unpinRepo: (workspaceId: string, repoPath: string) => ipcRenderer.invoke('unpin-repo', workspaceId, repoPath),

  // Sessions
  switchSession: (session: string) => ipcRenderer.invoke('switch-session', session),
  sleepSession: (session: string) => ipcRenderer.invoke('sleep-session', session),
  wakeSession: (session: string) => ipcRenderer.invoke('wake-session', session),
  destroySession: (session: string) => ipcRenderer.invoke('destroy-session', session),
  createWorkspaceSession: (workspaceName: string, workspaceDir: string, label?: string) =>
    ipcRenderer.invoke('create-workspace-session', workspaceName, workspaceDir, label),
  createRepoSession: (workspaceName: string, repoRoot: string, mode: string, branch?: string, base?: string, install?: boolean) =>
    ipcRenderer.invoke('create-repo-session', workspaceName, repoRoot, mode, branch, base, install),
  launchWorktreeSession: (workspaceName: string, repoRoot: string, branch: string, worktreePath: string) =>
    ipcRenderer.invoke('launch-worktree-session', workspaceName, repoRoot, branch, worktreePath),
  createStandaloneSession: (label: string, dir: string) =>
    ipcRenderer.invoke('create-standalone-session', label, dir),
  selectDirectory: () => ipcRenderer.invoke('select-directory'),

  // Worktrees
  createWorktree: (params: any) => ipcRenderer.invoke('create-worktree', params),
  removeWorktree: (repoRoot: string, branch: string, deleteBranch: boolean) =>
    ipcRenderer.invoke('remove-worktree', repoRoot, branch, deleteBranch),
  cleanWorktrees: (items: any[]) => ipcRenderer.invoke('clean-worktrees', items),

  // Windows
  selectWindow: (session: string, window: string) => ipcRenderer.invoke('select-window', session, window),
  newWindow: (session: string, name: string) => ipcRenderer.invoke('new-window', session, name),
  killWindow: (session: string, windowIndex: number) => ipcRenderer.invoke('kill-window', session, windowIndex),
  getBranches: (repoRoot: string) => ipcRenderer.invoke('get-branches', repoRoot),
  getCleanCandidates: () => ipcRenderer.invoke('get-clean-candidates'),

  // Preferences
  getPreferences: () => ipcRenderer.invoke('get-preferences'),
  setPreference: (key: string, value: unknown) => ipcRenderer.invoke('set-preference', key, value),

  // Theme
  getTheme: () => ipcRenderer.invoke('get-theme'),
  onThemeUpdate: (cb: (colors: any) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, colors: any) => cb(colors);
    ipcRenderer.on('theme-update', handler);
    return () => ipcRenderer.removeListener('theme-update', handler);
  },
});
