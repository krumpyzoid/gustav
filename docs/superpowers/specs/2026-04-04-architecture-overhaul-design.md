# Gustav Architecture Overhaul — Design Spec

## Goal

Restructure Gustav from a 3-file Electron MVP into a scalable, shareable desktop app with clean architecture, replacing the external `wt` CLI dependency with built-in worktree management and introducing React + shadcn/ui (Base UI) for proper UI components.

## Success Criteria

- Gustav is fully self-contained — no `wt` CLI dependency at runtime
- All worktree operations (create, remove, clean, checkout) happen through in-app dialogs
- Project follows Hybrid Services + Ports architecture with clear separation of concerns
- The app can be packaged and shared with others via Electron Forge
- Existing `.wt` config files and `~/.local/share/wt/repos.json` registry are backward compatible

---

## Architecture: Hybrid Services + Ports

Services contain business logic but depend on port interfaces rather than calling CLI tools directly. Adapters implement the ports. This gives testability and swappability without full DDD ceremony.

```
IPC Handler (thin) → Service (business logic) → Port (interface) → Adapter (implementation)
```

### Ports

| Port | Responsibility |
|------|---------------|
| `GitPort` | Worktree CRUD, branch queries, fetch, merge-check |
| `TmuxPort` | Session/window/pane lifecycle, pane content capture |
| `FileSystemPort` | Read, write, copy, exists, watch, mkdir |
| `ShellPort` | Exec arbitrary commands (hooks, install), env injection |

### Services

| Service | Depends on | Responsibility |
|---------|-----------|---------------|
| `WorktreeService` | GitPort, ShellPort, FileSystemPort, ConfigService, SessionService | Create/remove/clean worktrees (full `wt new`/`wt rm`/`wt clean` pipeline) |
| `SessionService` | TmuxPort, ConfigService | Tmux session lifecycle — create with Claude Code + lazygit + Shell + custom windows, switch, kill |
| `StateService` | GitPort, TmuxPort, RegistryService | Aggregate app state (sessions + worktrees + claude status), 5s poll + on-demand refresh |
| `ThemeService` | FileSystemPort | Load Omarchy/Ghostty theme, watch for changes, broadcast updates |
| `ConfigService` | FileSystemPort | Parse `.wt` config files per repo |
| `RegistryService` | FileSystemPort | CRUD for `~/.local/share/wt/repos.json` |

### Adapters

| Adapter | Implements | How |
|---------|-----------|-----|
| `GitAdapter` | GitPort | Shells out to `git` CLI via `child_process` |
| `TmuxAdapter` | TmuxPort | Shells out to `tmux` CLI via `child_process` |
| `FsAdapter` | FileSystemPort | Uses `node:fs` / `node:fs/promises` |
| `ShellAdapter` | ShellPort | Uses `child_process.exec` with cwd and env |

---

## Project Structure

```
src/
  main/
    index.ts                    # App lifecycle, window creation, DI wiring
    ipc/
      handlers.ts               # Thin IPC handlers → validate → call service → return Result
      channels.ts               # Channel name constants + type maps
    services/
      worktree.service.ts
      session.service.ts
      state.service.ts
      theme.service.ts
      config.service.ts
      registry.service.ts
    ports/
      git.port.ts
      tmux.port.ts
      filesystem.port.ts
      shell.port.ts
    adapters/
      git.adapter.ts
      tmux.adapter.ts
      fs.adapter.ts
      shell.adapter.ts
    domain/
      types.ts                  # Shared types: SessionEntry, ClaudeStatus, WtConfig, AppState, Result<T>, etc.
  preload/
    index.ts                    # contextBridge with typed API
    api.d.ts                    # Window.api type declarations
  renderer/
    index.html
    main.tsx                    # React root + providers
    App.tsx                     # Layout: sidebar + terminal
    hooks/
      use-app-state.ts          # Subscribe to state-update IPC, Zustand store
      use-theme.ts              # Subscribe to theme-update IPC
      use-terminal.ts           # xterm.js lifecycle
    components/
      sidebar/
        Sidebar.tsx
        RepoGroup.tsx
        SessionEntry.tsx
        StatusDot.tsx
      terminal/
        Terminal.tsx
        ResizeHandle.tsx
      dialogs/
        NewWorktreeDialog.tsx
        CleanWorktreesDialog.tsx
        RemoveWorktreeDialog.tsx
        ConfirmDialog.tsx
        NewSessionDialog.tsx
    lib/
      utils.ts                  # shadcn cn() utility
    styles/
      globals.css               # Tailwind base + theme CSS custom properties
```

### Root Config Files

```
electron.vite.config.ts         # electron-vite: main + preload + renderer
tsconfig.json                   # Base TS config
tsconfig.main.json              # Main process (Node)
tsconfig.preload.json           # Preload (restricted Node)
tsconfig.renderer.json          # Renderer (browser + React)
tailwind.config.ts              # Tailwind with theme vars
components.json                 # shadcn/ui config (Base UI primitives)
forge.config.ts                 # Electron Forge packaging
package.json
```

---

## IPC Design

### Type-Safe Channel Map

```typescript
// src/main/domain/types.ts

type Result<T> =
  | { success: true; data: T }
  | { success: false; error: string }

type IpcChannelMap = {
  // Queries
  'get-state':            { args: [];                               ret: AppState }
  'get-theme':            { args: [];                               ret: ThemeColors }
  'get-branches':         { args: [repoRoot: string];               ret: BranchInfo[] }
  'get-clean-candidates': { args: [];                               ret: CleanCandidate[] }

  // Commands (all return Result<T>)
  'switch-session':       { args: [session: string];                ret: Result<void> }
  'kill-session':         { args: [session: string];                ret: Result<void> }
  'create-session':       { args: [name: string];                   ret: Result<void> }
  'start-session':        { args: [session: string, workdir: string]; ret: Result<void> }
  'create-worktree':      { args: [params: CreateWorktreeParams];   ret: Result<void> }
  'remove-worktree':      { args: [repo: string, branch: string, deleteBranch: boolean]; ret: Result<void> }
  'clean-worktrees':      { args: [items: CleanTarget[]];           ret: Result<CleanReport> }
  'remove-repo':          { args: [repoName: string];               ret: Result<void> }

  // Streams (fire-and-forget)
  'pty-input':            { args: [data: string] }
  'pty-resize':           { args: [cols: number, rows: number] }
}

type IpcEventMap = {
  // Main → Renderer broadcasts
  'state-update':   AppState
  'theme-update':   ThemeColors
  'pty-data':       string
}
```

### IPC Handler Pattern

Handlers are thin — validate input, call service, wrap result:

```typescript
ipcMain.handle('create-worktree', async (_event, params: CreateWorktreeParams) => {
  try {
    await worktreeService.create(params);
    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
});
```

### Preload Bridge

contextBridge exposes a typed API object. Types are shared via `src/main/domain/types.ts` imported at build time into `src/preload/api.d.ts`.

---

## Domain Types

```typescript
type ClaudeStatus = 'action' | 'busy' | 'done' | 'none';

type SessionEntry = {
  repo: string;
  branch: string;
  tmuxSession: string | null;
  status: ClaudeStatus;
  worktreePath: string | null;
  isMainWorktree: boolean;
};

type AppState = {
  entries: SessionEntry[];
  repos: [name: string, path: string][];
};

type ThemeColors = Record<string, string>;

type BranchInfo = {
  name: string;
  isLocal: boolean;
  isRemote: boolean;
};

type CreateWorktreeParams = {
  repo: string;
  repoRoot: string;
  branch: string;
  base: string;
  install: boolean;
};

type CleanCandidate = {
  repo: string;
  repoRoot: string;
  branch: string;
  worktreePath: string;
  reason: 'merged' | 'remote-deleted';
};

type CleanTarget = {
  repoRoot: string;
  branch: string;
  worktreePath: string;
  deleteBranch: boolean;
};

type CleanReport = {
  removed: number;
  errors: string[];
};

type WtConfig = {
  env: Record<string, string>;
  copy: string[];
  install: string;
  base: string;
  hooks: Record<string, string>;
  tmux: string[];
  cleanMergedInto: string;  // NEW: defaults to 'origin/staging'
};
```

---

## Worktree Operations (Replacing `wt`)

### Create Worktree (`wt new` equivalent)

Triggered by NewWorktreeDialog. WorktreeService.create() pipeline:

1. Parse `.wt` config for the repo
2. Check if branch exists (local/remote)
3. If new branch: `git fetch origin`, `git worktree add <path> -b <branch> <base>`
4. If existing branch: `git worktree add <path> <branch>`
5. Run `pre_new` hook (via ShellPort)
6. Copy `.claude/settings.local.json` if exists
7. Write `.env` from config or copy from root
8. Copy files from `[copy]` config
9. Run install command from `[install]` config
10. Run `post_new` hook
11. Launch tmux session via SessionService (Claude Code + lazygit + Shell + custom windows from `[tmux]` config)

### Remove Worktree (`wt rm` equivalent)

Triggered by RemoveWorktreeDialog. WorktreeService.remove() pipeline:

1. Parse `.wt` config
2. Run `pre_rm` hook
3. `git worktree remove <path> --force`
4. Kill tmux session
5. Optionally delete branch (user chooses in dialog; dialog shows merge status)
6. Run `post_rm` hook

### Clean Stale Worktrees (`wt clean` equivalent)

Two-step: first `get-clean-candidates` populates the dialog, then `clean-worktrees` executes.

**get-clean-candidates** (WorktreeService.getCleanCandidates()):
1. For each registered repo:
   - Parse `.wt` config to get `cleanMergedInto` target (default: `origin/staging`)
   - `git fetch origin --prune`
   - List worktrees
   - For each: check if branch is merged into target OR remote branch deleted
2. Return flat list of CleanCandidate[] grouped by repo in the dialog

**clean-worktrees** (WorktreeService.clean()):
1. Run `pre_clean` hook for each affected repo
2. For each selected target:
   - `git worktree remove <path> --force`
   - Kill tmux session
   - Delete branch if `deleteBranch` is true
3. `git worktree prune` for each affected repo
4. Run `post_clean` hook for each affected repo
5. Return CleanReport with count and any errors

### Start Session (orphan worktree activation)

Triggered by clicking an orphan entry in the sidebar. SessionService.launch():

1. Create tmux session with `Claude Code` window, send `claude` command
2. Create `Git` window, send `lazygit`
3. Create `Shell` window
4. Create custom windows from `.wt` `[tmux]` config
5. Select `Claude Code` window
6. Switch PTY client to new session

---

## `.wt` Config Changes

One additive section. Fully backward compatible — repos without `[clean]` default to `origin/staging`.

```ini
# NEW section
[clean]
merged_into=origin/staging
```

The `ConfigService` parser adds this field to `WtConfig.cleanMergedInto`, defaulting to `'origin/staging'` when absent.

---

## UI Components

### Renderer Stack

- **React 19** with strict mode
- **shadcn/ui** configured with **Base UI** primitives (via `npx shadcn create` with base-ui selection)
- **Tailwind CSS v4** with theme CSS custom properties mapped from Omarchy colors
- **Zustand** for renderer state (sessions, repos, active session, dialog state)
- **xterm.js** wrapped in a React component with useEffect lifecycle

### Component Hierarchy

```
App
  ├── Sidebar
  │     ├── RepoGroup (per repo)
  │     │     ├── SessionEntry (per session/orphan)
  │     │     │     └── StatusDot
  │     │     └── "+ new worktree" button → NewWorktreeDialog
  │     └── ActionBar
  │           ├── "+ session" button → NewSessionDialog
  │           └── "clean" button → CleanWorktreesDialog
  ├── ResizeHandle
  └── Terminal (xterm.js)
```

### Dialog Components

**NewWorktreeDialog** — shadcn Dialog + Select + Input + Checkbox + Button
- Repo field (pre-selected from context, or select if triggered globally)
- Branch name text input
- Base ref select (populated via `get-branches` IPC on open; default from `.wt` config)
- "Run install" checkbox (label shows the actual command from config)
- Create / Cancel buttons

**CleanWorktreesDialog** — shadcn Dialog + Checkbox
- Cross-repo view, grouped by repo name headers
- Each entry: checkbox + branch name + reason badge ("merged to staging" / "remote deleted")
- Footer: selection count + "Clean N worktrees" (destructive red) / Cancel

**RemoveWorktreeDialog** — shadcn Dialog + Checkbox
- Context display: repo, branch, merge status
- "Also delete branch" checkbox
- Remove (destructive red) / Cancel

**NewSessionDialog** — shadcn Dialog + Input
- Session name text input
- Create / Cancel

**ConfirmDialog** — reusable shadcn AlertDialog
- Title, description, confirm/cancel

### Theme Integration

Omarchy theme colors are loaded by ThemeService and broadcast as `ThemeColors`. In the renderer:

1. `useTheme` hook receives colors and sets CSS custom properties on `:root`
2. Tailwind config maps these custom properties: `--bg`, `--fg`, `--accent`, `--c0` through `--c15`
3. shadcn components use Tailwind classes that reference these variables
4. xterm.js theme object is derived from the same colors

---

## State Management

### Main Process (source of truth)

StateService aggregates state every 5s via polling:
- RegistryService → registered repos
- TmuxPort → active sessions, claude status detection
- GitPort → worktree list, orphan detection

Commands trigger an immediate state broadcast after completion.

### Renderer (Zustand store)

```typescript
type AppStore = {
  entries: SessionEntry[];
  repos: Map<string, string>;
  activeSession: string | null;
  setEntries: (entries: SessionEntry[]) => void;
  setRepos: (repos: [string, string][]) => void;
  setActiveSession: (session: string | null) => void;
};
```

`useAppState` hook subscribes to `state-update` IPC events and syncs to the Zustand store. Components select slices they need — no full sidebar re-render on every update.

---

## Tooling

| Tool | Purpose |
|------|---------|
| electron-vite | Unified dev server + build for main/preload/renderer with HMR |
| Electron Forge | Packaging and distribution (makers for deb, rpm, AppImage) |
| TypeScript | Strict mode, 3 tsconfig targets |
| Tailwind CSS v4 | Utility-first styling with theme variables |
| shadcn/ui (Base UI) | Accessible component primitives |
| Zustand | Lightweight renderer state |
| xterm.js + addon-fit | Terminal emulation |
| node-pty | PTY allocation |

---

## Security

Following Electron best practices:
- `contextIsolation: true` (default)
- `sandbox: true`
- `nodeIntegration: false` (default)
- Preload uses `contextBridge.exposeInMainWorld()` — no raw `ipcRenderer` exposure
- All IPC arguments validated in handlers before passing to services
- Shell commands use parameterized arguments — no string interpolation of user input into shell commands

---

## Migration Phases

### Phase 1: Scaffold
- Initialize electron-vite project structure
- Set up React + Tailwind + shadcn/ui (Base UI)
- Create 3 TypeScript configs (main, preload, renderer)
- Define all domain types in `src/main/domain/types.ts`
- Define all port interfaces
- Define IPC channel map and constants

### Phase 2: Main Process
- Implement all 4 adapters (git, tmux, fs, shell)
- Implement all 6 services
- Implement typed IPC handlers with Result pattern
- Implement preload bridge with contextBridge
- Port all `wt` logic (new, rm, clean) into WorktreeService
- Port Claude status detection into StateService
- Port theme loading/watching into ThemeService
- Port registry CRUD into RegistryService
- Port `.wt` config parsing into ConfigService (add `[clean]` section)

### Phase 3: Renderer
- React app shell (App.tsx with sidebar + terminal layout)
- Terminal component (xterm.js wrapper with useTerminal hook)
- ResizeHandle component
- Sidebar with RepoGroup, SessionEntry, StatusDot
- Zustand store + useAppState hook
- Theme hook + Tailwind integration
- All dialog components (NewWorktree, CleanWorktrees, RemoveWorktree, NewSession, Confirm)
- Replace all `confirm()` calls with ConfirmDialog

### Phase 4: Package & Ship
- Electron Forge configuration
- Verify no `wt` CLI calls remain
- Test on clean machine (no `wt` installed)
- Build distributable artifacts

---

## What This Does NOT Cover

- Auto-updates (electron-updater) — future enhancement
- Multi-platform packaging (macOS, Windows) — Linux only for now
- Tests — should be added but not in scope for the initial rewrite
- Keyboard shortcuts / command palette — future enhancement
