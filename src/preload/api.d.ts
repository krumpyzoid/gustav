import type {
  WorkspaceAppState,
  Workspace,
  ThemeColors,
  BranchInfo,
  CreateWorktreeParams,
  CleanCandidate,
  CleanTarget,
  CleanReport,
  Result,
  WindowInfo,
  Preferences,
  WindowSpec,
} from '../main/domain/types';
import type { TabConfig } from '../main/domain/tab-config';
import type { RepoConfig } from '../main/domain/repo-config';
import type { ManagedWindow } from '../main/supervisor/types';

/** Metadata about a saved remote server (returned by getSavedServers). */
export interface SavedServer {
  id: string;
  host: string;
  port: number;
  pairedAt?: number;
  lastConnectedAt?: number;
}

/** Information about the local Gustav host (returned wrapped in Result by getHostInfo). */
export interface HostInfo {
  enabled: boolean;
  port: number | null;
  pairingCode: string | null;
  pairingExpiresAt: number | null;
  clientConnected: boolean;
  clientAddress: string | null;
}

interface ElectronAPI {
  // Clipboard
  writeClipboard: (text: string) => void;

  // PTY
  onPtyData: (cb: (data: string) => void) => () => void;
  sendPtyInput: (data: string) => void;
  sendPtyResize: (cols: number, rows: number) => void;

  // State
  getState: () => Promise<WorkspaceAppState>;
  onStateUpdate: (cb: (state: WorkspaceAppState) => void) => () => void;

  // Workspace
  createWorkspace: (name: string, directory: string) => Promise<Result<Workspace>>;
  renameWorkspace: (id: string, newName: string) => Promise<Result<void>>;
  removeWorkspace: (id: string) => Promise<Result<void>>;
  deleteWorkspace: (id: string, deleteWorktrees: boolean) => Promise<Result<void>>;
  reorderWorkspaces: (ids: string[]) => Promise<Result<void>>;
  reorderWithinWorkspace: (workspaceId: string, ordering: Record<string, unknown>) => Promise<Result<void>>;
  discoverRepos: (directory: string) => Promise<Result<string[]>>;
  pinRepos: (workspaceId: string, repoPaths: string[]) => Promise<Result<void>>;
  unpinRepo: (workspaceId: string, repoPath: string) => Promise<Result<void>>;

  // Sessions
  switchSession: (session: string) => Promise<Result<WindowInfo[]>>;
  sleepSession: (session: string) => Promise<Result<void>>;
  wakeSession: (session: string) => Promise<Result<WindowInfo[]>>;
  destroySession: (session: string) => Promise<Result<void>>;
  createWorkspaceSession: (workspaceName: string, workspaceDir: string, label?: string) => Promise<Result<string>>;
  createRepoSession: (workspaceName: string, repoRoot: string, mode: string, branch?: string, base?: string, install?: boolean) => Promise<Result<string>>;
  launchWorktreeSession: (workspaceName: string, repoRoot: string, branch: string, worktreePath: string) => Promise<Result<string>>;
  createStandaloneSession: (label: string, dir: string) => Promise<Result<string>>;
  selectDirectory: () => Promise<Result<string | null>>;

  // Windows
  selectWindow: (session: string, window: string) => Promise<Result<void>>;
  newWindow: (session: string, name: string) => Promise<Result<void>>;
  killWindow: (session: string, windowIndex: number) => Promise<Result<void>>;
  setWindowOrder: (session: string, names: string[]) => Promise<Result<void>>;

  // Worktrees
  createWorktree: (params: CreateWorktreeParams) => Promise<Result<void>>;
  removeWorktree: (repoRoot: string, branch: string, deleteBranch: boolean) => Promise<Result<void>>;
  cleanWorktrees: (items: CleanTarget[]) => Promise<Result<CleanReport>>;
  getBranches: (repoRoot: string) => Promise<BranchInfo[]>;
  getCleanCandidates: () => Promise<CleanCandidate[]>;

  // Theme
  getTheme: () => Promise<ThemeColors>;
  onThemeUpdate: (cb: (colors: ThemeColors) => void) => () => void;

  // Preferences
  getPreferences: () => Promise<Preferences>;
  setPreference: (key: string, value: unknown) => Promise<Preferences>;
  setDefaultTabs: (tabs: TabConfig[]) => Promise<Result<Preferences>>;
  setWorkspaceDefaultTabs: (workspaceId: string, tabs: TabConfig[] | null) => Promise<Result<void>>;

  // Repo config
  getRepoConfig: (repoRoot: string) => Promise<RepoConfig | null>;
  setRepoConfig: (repoRoot: string, config: RepoConfig | null) => Promise<Result<void>>;

  // Remote server (host side)
  enableRemote: (port: number) => Promise<Result<HostInfo>>;
  disableRemote: () => Promise<Result<void>>;
  getHostInfo: () => Promise<Result<HostInfo>>;
  disconnectRemoteClient: () => Promise<Result<void>>;
  regeneratePairingCode: () => Promise<Result<HostInfo>>;

  // Remote client (this Gustav connecting to another)
  connectRemote: (host: string, port: number, code: string) => Promise<Result<void>>;
  disconnectRemote: () => Promise<Result<void>>;
  getRemoteState: () => Promise<Result<{ status: string }>>;
  remoteSessionCommand: (action: string, params: Record<string, unknown>) => Promise<Result<any>>;
  sendRemotePtyInput: (channelId: number, data: string) => void;
  sendRemotePtyResize: (channelId: number, cols: number, rows: number) => void;
  forwardPort: (remotePort: number, localPort?: number) => Promise<Result<{ localPort: number }>>;
  stopForward: (channelId: number) => Promise<Result<void>>;
  getSavedServers: () => Promise<SavedServer[]>;
  deleteSavedServer: (id: string) => Promise<Result<void>>;
  connectSavedServer: (id: string) => Promise<Result<void>>;
  onRemoteStateUpdate: (cb: (state: WorkspaceAppState) => void) => () => void;
  onRemotePtyData: (cb: (data: string) => void) => () => void;
  onRemoteConnectionStatus: (cb: (status: string) => void) => () => void;

  // Supervisor (Phase 3 strangler — `supervisor:` IPC surface)
  supervisor: SupervisorApi;
}

/** Supervisor IPC surface mirrored on the renderer. */
export interface SupervisorApi {
  createSession: (opts: { sessionId: string; cwd: string; windows: WindowSpec[] }) => Promise<Result<void>>;
  killSession: (sessionId: string) => Promise<Result<void>>;
  hasSession: (sessionId: string) => Promise<Result<boolean>>;
  addWindow: (sessionId: string, spec: WindowSpec) => Promise<Result<string>>;
  killWindow: (sessionId: string, windowId: string) => Promise<Result<void>>;
  selectWindow: (sessionId: string, windowId: string) => Promise<Result<void>>;
  listWindows: (sessionId: string) => Promise<Result<ManagedWindow[]>>;
  sleepSession: (sessionId: string) => Promise<Result<void>>;
  wakeSession: (sessionId: string) => Promise<Result<void>>;
  attachClient: (payload: { sessionId: string; clientId: string; cols: number; rows: number }) => void;
  detachClient: (sessionId: string, clientId: string) => void;
  resizeClient: (payload: { sessionId: string; clientId: string; cols: number; rows: number }) => void;
  sendInput: (sessionId: string, data: string) => void;
  getReplay: (sessionId: string, windowId: string) => Promise<Result<string>>;
  onData: (cb: (payload: { sessionId: string; windowId: string; data: string }) => void) => () => void;
  onStateChange: (cb: (payload: { sessionId: string }) => void) => () => void;
}

declare global {
  interface Window {
    api: ElectronAPI;
  }
}
