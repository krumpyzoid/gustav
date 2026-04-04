const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  // PTY
  onPtyData: (cb) => ipcRenderer.on("pty-data", (_e, data) => cb(data)),
  sendPtyInput: (data) => ipcRenderer.send("pty-input", data),
  sendPtyResize: (cols, rows) => ipcRenderer.send("pty-resize", { cols, rows }),

  // State
  getState: () => ipcRenderer.invoke("get-state"),
  onStateUpdate: (cb) => ipcRenderer.on("state-update", (_e, state) => cb(state)),

  // Actions
  switchSession: (session) => ipcRenderer.invoke("switch-session", session),
  killSession: (session) => ipcRenderer.invoke("kill-session", session),
  removeWorktree: (repo, branch) => ipcRenderer.invoke("remove-worktree", repo, branch),
  createSession: (name) => ipcRenderer.invoke("create-session", name),
  startSession: (session, workdir) => ipcRenderer.invoke("start-session", session, workdir),
  createWorktree: (repoRoot) => ipcRenderer.invoke("create-worktree", repoRoot),
  removeRepo: (repoName) => ipcRenderer.invoke("remove-repo", repoName),

  // Theme
  getTheme: () => ipcRenderer.invoke("get-theme"),
  onThemeUpdate: (cb) => ipcRenderer.on("theme-update", (_e, colors) => cb(colors)),
});
