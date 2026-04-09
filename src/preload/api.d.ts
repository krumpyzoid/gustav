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
} from '../main/domain/types';

interface ElectronAPI {
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
  reorderWorkspaces: (ids: string[]) => Promise<Result<void>>;
  reorderWithinWorkspace: (workspaceId: string, ordering: Record<string, unknown>) => Promise<Result<void>>;
  discoverRepos: (directory: string) => Promise<Result<string[]>>;

  // Sessions
  switchSession: (session: string) => Promise<Result<WindowInfo[]>>;
  killSession: (session: string) => Promise<Result<void>>;
  createWorkspaceSession: (workspaceName: string, workspaceDir: string, label?: string) => Promise<Result<string>>;
  createRepoSession: (workspaceName: string, repoRoot: string, mode: string, branch?: string, base?: string, install?: boolean) => Promise<Result<string>>;
  createStandaloneSession: (label: string, dir: string) => Promise<Result<string>>;
  selectDirectory: () => Promise<Result<string | null>>;

  // Windows
  selectWindow: (session: string, window: string) => Promise<Result<void>>;
  newWindow: (session: string, name: string) => Promise<Result<void>>;
  killWindow: (session: string, windowIndex: number) => Promise<Result<void>>;

  // Worktrees
  createWorktree: (params: CreateWorktreeParams) => Promise<Result<void>>;
  removeWorktree: (repoRoot: string, branch: string, deleteBranch: boolean) => Promise<Result<void>>;
  cleanWorktrees: (items: CleanTarget[]) => Promise<Result<CleanReport>>;
  getBranches: (repoRoot: string) => Promise<BranchInfo[]>;
  getCleanCandidates: () => Promise<CleanCandidate[]>;

  // Theme
  getTheme: () => Promise<ThemeColors>;
  onThemeUpdate: (cb: (colors: ThemeColors) => void) => () => void;
}

declare global {
  interface Window {
    api: ElectronAPI;
  }
}
