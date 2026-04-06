import type {
  AppState,
  ThemeColors,
  BranchInfo,
  CreateWorktreeParams,
  CleanCandidate,
  CleanTarget,
  CleanReport,
  Result,
} from '../main/domain/types';

interface ElectronAPI {
  // PTY
  onPtyData: (cb: (data: string) => void) => () => void;
  sendPtyInput: (data: string) => void;
  sendPtyResize: (cols: number, rows: number) => void;

  // State
  getState: () => Promise<AppState>;
  onStateUpdate: (cb: (state: AppState) => void) => () => void;

  // Actions
  switchSession: (session: string) => Promise<Result<void>>;
  killSession: (session: string) => Promise<Result<void>>;
  createSession: (name: string) => Promise<Result<void>>;
  startSession: (session: string, workdir: string) => Promise<Result<void>>;
  createWorktree: (params: CreateWorktreeParams) => Promise<Result<void>>;
  removeWorktree: (repoRoot: string, branch: string, deleteBranch: boolean) => Promise<Result<void>>;
  cleanWorktrees: (items: CleanTarget[]) => Promise<Result<CleanReport>>;
  pinProjects: () => Promise<Result<string[]>>;
  unpinProject: (repoName: string) => Promise<Result<void>>;
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
