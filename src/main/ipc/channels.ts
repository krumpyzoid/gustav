export const Channels = {
  // Queries
  GET_STATE: 'get-state',
  GET_THEME: 'get-theme',
  GET_BRANCHES: 'get-branches',
  GET_CLEAN_CANDIDATES: 'get-clean-candidates',

  // Commands
  SWITCH_SESSION: 'switch-session',
  KILL_SESSION: 'kill-session',
  CREATE_SESSION: 'create-session',
  START_SESSION: 'start-session',
  CREATE_WORKTREE: 'create-worktree',
  REMOVE_WORKTREE: 'remove-worktree',
  CLEAN_WORKTREES: 'clean-worktrees',
  PIN_PROJECTS: 'pin-projects',
  UNPIN_PROJECT: 'unpin-project',
  SELECT_WINDOW: 'select-window',

  // Streams (fire-and-forget)
  PTY_INPUT: 'pty-input',
  PTY_RESIZE: 'pty-resize',

  // Events (main → renderer)
  STATE_UPDATE: 'state-update',
  THEME_UPDATE: 'theme-update',
  PTY_DATA: 'pty-data',
} as const;
