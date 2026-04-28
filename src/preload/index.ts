import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
  // Clipboard — main-process write bypasses macOS focus restrictions on
  // navigator.clipboard.writeText, which silently fails when the window is
  // unfocused.
  writeClipboard: (text: string) => ipcRenderer.send('clipboard-write', text),

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
  deleteWorkspace: (id: string, deleteWorktrees: boolean) => ipcRenderer.invoke('delete-workspace', id, deleteWorktrees),
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
  createRepoSession: (workspaceName: string, repoRoot: string, mode: string, branch?: string, base?: string) =>
    ipcRenderer.invoke('create-repo-session', workspaceName, repoRoot, mode, branch, base),
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
  setWindowOrder: (session: string, names: string[]) => ipcRenderer.invoke('set-window-order', session, names),
  getBranches: (repoRoot: string) => ipcRenderer.invoke('get-branches', repoRoot),
  getCleanCandidates: () => ipcRenderer.invoke('get-clean-candidates'),

  // Preferences
  getPreferences: () => ipcRenderer.invoke('get-preferences'),
  setPreference: (key: string, value: unknown) => ipcRenderer.invoke('set-preference', key, value),
  setDefaultTabs: (tabs: unknown[]) => ipcRenderer.invoke('set-default-tabs', tabs),
  setWorkspaceDefaultTabs: (workspaceId: string, tabs: unknown[] | null) =>
    ipcRenderer.invoke('set-workspace-default-tabs', workspaceId, tabs),

  // Repo config
  getRepoConfig: (repoRoot: string) => ipcRenderer.invoke('get-repo-config', repoRoot),
  setRepoConfig: (repoRoot: string, config: unknown) =>
    ipcRenderer.invoke('set-repo-config', repoRoot, config),

  // Theme
  getTheme: () => ipcRenderer.invoke('get-theme'),
  onThemeUpdate: (cb: (colors: any) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, colors: any) => cb(colors);
    ipcRenderer.on('theme-update', handler);
    return () => ipcRenderer.removeListener('theme-update', handler);
  },

  // Remote server
  enableRemote: (port: number) => ipcRenderer.invoke('enable-remote', port),
  disableRemote: () => ipcRenderer.invoke('disable-remote'),
  getHostInfo: () => ipcRenderer.invoke('get-host-info'),
  disconnectRemoteClient: () => ipcRenderer.invoke('disconnect-remote-client'),
  regeneratePairingCode: () => ipcRenderer.invoke('regenerate-pairing-code'),

  // Remote client
  connectRemote: (host: string, port: number, code: string) =>
    ipcRenderer.invoke('connect-remote', host, port, code),
  disconnectRemote: () => ipcRenderer.invoke('disconnect-remote'),
  getRemoteState: () => ipcRenderer.invoke('get-remote-state'),
  remoteSessionCommand: (action: string, params: any) =>
    ipcRenderer.invoke('remote-session-command', action, params),
  sendRemotePtyInput: (channelId: number, data: string) =>
    ipcRenderer.send('remote-pty-input', channelId, data),
  sendRemotePtyResize: (channelId: number, cols: number, rows: number) =>
    ipcRenderer.send('remote-pty-resize', channelId, cols, rows),
  forwardPort: (remotePort: number, localPort?: number) =>
    ipcRenderer.invoke('forward-port', remotePort, localPort),
  stopForward: (channelId: number) => ipcRenderer.invoke('stop-forward', channelId),
  getSavedServers: () => ipcRenderer.invoke('get-saved-servers'),
  deleteSavedServer: (id: string) => ipcRenderer.invoke('delete-saved-server', id),
  connectSavedServer: (id: string) => ipcRenderer.invoke('connect-saved-server', id),
  onRemoteStateUpdate: (cb: (state: any) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, state: any) => cb(state);
    ipcRenderer.on('remote-state-update', handler);
    return () => ipcRenderer.removeListener('remote-state-update', handler);
  },
  onRemotePtyData: (cb: (data: any) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, data: any) => cb(data);
    ipcRenderer.on('remote-pty-data', handler);
    return () => ipcRenderer.removeListener('remote-pty-data', handler);
  },
  onRemoteConnectionStatus: (cb: (status: string) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, status: string) => cb(status);
    ipcRenderer.on('remote-connection-status', handler);
    return () => ipcRenderer.removeListener('remote-connection-status', handler);
  },

  // ── Supervisor (Phase 3 strangler) ────────────────────────────────
  // Mirrors the tmux IPC surface with a `supervisor:` prefix. Routed to
  // when preferences.sessionSupervisor === 'native'.
  supervisor: {
    createSession: (opts: { sessionId: string; cwd: string; windows: unknown[] }) =>
      ipcRenderer.invoke('supervisor:create-session', opts),
    killSession: (sessionId: string) =>
      ipcRenderer.invoke('supervisor:kill-session', sessionId),
    hasSession: (sessionId: string) =>
      ipcRenderer.invoke('supervisor:has-session', sessionId),
    addWindow: (sessionId: string, spec: unknown) =>
      ipcRenderer.invoke('supervisor:add-window', sessionId, spec),
    killWindow: (sessionId: string, windowId: string) =>
      ipcRenderer.invoke('supervisor:kill-window', sessionId, windowId),
    selectWindow: (sessionId: string, windowId: string) =>
      ipcRenderer.invoke('supervisor:select-window', sessionId, windowId),
    listWindows: (sessionId: string) =>
      ipcRenderer.invoke('supervisor:list-windows', sessionId),
    sleepSession: (sessionId: string) =>
      ipcRenderer.invoke('supervisor:sleep', sessionId),
    wakeSession: (sessionId: string) =>
      ipcRenderer.invoke('supervisor:wake', sessionId),
    attachClient: (payload: { sessionId: string; clientId: string; cols: number; rows: number }) =>
      ipcRenderer.send('supervisor:attach-client', payload),
    detachClient: (sessionId: string, clientId: string) =>
      ipcRenderer.send('supervisor:detach-client', sessionId, clientId),
    resizeClient: (payload: { sessionId: string; clientId: string; cols: number; rows: number }) =>
      ipcRenderer.send('supervisor:resize-client', payload),
    sendInput: (sessionId: string, data: string) =>
      ipcRenderer.send('supervisor:input', sessionId, data),
    getReplay: (sessionId: string, windowId: string) =>
      ipcRenderer.invoke('supervisor:replay', sessionId, windowId),
    onData: (cb: (payload: { sessionId: string; windowId: string; data: string }) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, payload: { sessionId: string; windowId: string; data: string }) =>
        cb(payload);
      ipcRenderer.on('supervisor:on-data', handler);
      return () => ipcRenderer.removeListener('supervisor:on-data', handler);
    },
    onStateChange: (cb: (payload: { sessionId: string }) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, payload: { sessionId: string }) => cb(payload);
      ipcRenderer.on('supervisor:on-state-change', handler);
      return () => ipcRenderer.removeListener('supervisor:on-state-change', handler);
    },
  },
});
