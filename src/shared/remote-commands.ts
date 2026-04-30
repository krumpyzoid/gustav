/**
 * Command names for the remote-control protocol.
 *
 * Both the renderer-side `RemoteGustavTransport` and the main-side
 * `CommandDispatcher` import these constants so the two sides stay in lockstep
 * across renames or additions. Adding a new command requires updating both
 * files only after extending this enum.
 *
 * Wire-format note: these are intentionally kebab-case strings so the
 * existing protocol tests and any external clients keep working.
 */
export const RemoteCommand = {
  GetState: 'get-state',
  GetBranches: 'get-branches',
  DiscoverRepos: 'discover-repos',

  // Window operations
  ListWindows: 'list-windows',
  SelectWindow: 'select-window',
  NewWindow: 'new-window',
  KillWindow: 'kill-window',
  SetWindowOrder: 'set-window-order',

  // Session lifecycle
  SleepSession: 'sleep-session',
  WakeSession: 'wake-session',
  DestroySession: 'destroy-session',

  // Session creation
  CreateWorkspaceSession: 'create-workspace-session',
  CreateRepoSession: 'create-repo-session',
  CreateStandaloneSession: 'create-standalone-session',

  // PTY data plane (handled directly by RemoteService, not the dispatcher)
  AttachPty: 'attach-pty',
  DetachPty: 'detach-pty',
  ResizePty: 'resize-pty',
} as const;

export type RemoteCommandName = (typeof RemoteCommand)[keyof typeof RemoteCommand];
