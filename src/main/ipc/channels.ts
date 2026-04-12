export const Channels = {
  // Queries
  GET_STATE: 'get-state',
  GET_THEME: 'get-theme',
  GET_BRANCHES: 'get-branches',
  GET_CLEAN_CANDIDATES: 'get-clean-candidates',
  DISCOVER_REPOS: 'discover-repos',

  // Workspace commands
  CREATE_WORKSPACE: 'create-workspace',
  RENAME_WORKSPACE: 'rename-workspace',
  REMOVE_WORKSPACE: 'remove-workspace',
  REORDER_WORKSPACES: 'reorder-workspaces',
  REORDER_WITHIN_WORKSPACE: 'reorder-within-workspace',

  // Session commands
  SWITCH_SESSION: 'switch-session',
  SLEEP_SESSION: 'sleep-session',
  WAKE_SESSION: 'wake-session',
  DESTROY_SESSION: 'destroy-session',
  CREATE_WORKSPACE_SESSION: 'create-workspace-session',
  CREATE_REPO_SESSION: 'create-repo-session',
  LAUNCH_WORKTREE_SESSION: 'launch-worktree-session',
  CREATE_STANDALONE_SESSION: 'create-standalone-session',
  SELECT_DIRECTORY: 'select-directory',

  // Pin/unpin repos
  PIN_REPOS: 'pin-repos',
  UNPIN_REPO: 'unpin-repo',

  // Worktree commands
  CREATE_WORKTREE: 'create-worktree',
  REMOVE_WORKTREE: 'remove-worktree',
  CLEAN_WORKTREES: 'clean-worktrees',

  // Window commands
  SELECT_WINDOW: 'select-window',
  NEW_WINDOW: 'new-window',
  KILL_WINDOW: 'kill-window',

  // Preferences
  GET_PREFERENCES: 'get-preferences',
  SET_PREFERENCE: 'set-preference',

  // Streams (fire-and-forget)
  PTY_INPUT: 'pty-input',
  PTY_RESIZE: 'pty-resize',

  // Events (main → renderer)
  STATE_UPDATE: 'state-update',
  THEME_UPDATE: 'theme-update',
  PTY_DATA: 'pty-data',
} as const;
