# Plan: Workspaces

**Created**: 2026-04-09
**Branch**: main
**Status**: implemented

## Goal

Replace the current "Projects" model (flat pinned git repos) with "Workspaces" — named containers tied to a unique directory that group sessions by context rather than by individual repo. Workspaces support three session types (workspace, directory, worktree), use command-based Claude status detection (scanning all panes for `claude` process instead of matching window name), and display animated nerd font status icons. A default unnamed workspace at the top of the sidebar holds standalone sessions.

## Acceptance Criteria

- [ ] Workspaces can be created (name + directory), renamed, and unpinned
- [ ] Workspace data persists in `~/.local/share/gustav/workspaces.json`; directory is unique across workspaces
- [ ] Workspace sessions launch with claude + shell windows, plus `.gustav` config windows
- [ ] Repository sessions discover git repos under workspace dir, user picks repo then root or new worktree
- [ ] Standalone sessions (directory or repository) appear in the default unnamed workspace at top
- [ ] Sidebar shows default workspace at top, named workspace accordions below
- [ ] Inside each workspace: workspace sessions first, then repo groups (directory first, worktrees, orphans at bottom)
- [ ] Tab rows show: animated status icon (cycling nerd font symbols when busy, red dot when action), type icon, session name, status text
- [ ] Workspace accordion header shows worst status across all child sessions
- [ ] Claude status detection scans all panes for running `claude` command (not window name); worst status wins when multiple panes run claude
- [ ] Manually-launched `claude` instances are tracked
- [ ] `.gustav` config file used instead of `.wt` (same schema)
- [ ] All new UI uses Tailwind scale/rem font sizes and shadcn semantic color tokens

## Steps

### Step 1: New domain types

**Complexity**: standard
**RED**: Write tests asserting `Workspace` and `SessionTab` types exist with required fields; test a `worstStatus()` helper that computes `action > busy > done > new > none`
**GREEN**: Define `Workspace { id, name, directory }`, `SessionTab { workspaceId, type, tmuxSession, repoName, branch, worktreePath, status }`, `SessionType = 'workspace' | 'directory' | 'worktree'` in `types.ts`. Implement `worstStatus(statuses: ClaudeStatus[]): ClaudeStatus` as a pure function
**REFACTOR**: None needed
**Files**: `src/main/domain/types.ts`, `src/main/domain/__tests__/types.test.ts`
**Commit**: `feat: add workspace and session tab domain types with worstStatus helper`

### Step 2: Workspace persistence service

**Complexity**: standard
**RED**: Write tests for `WorkspaceService`: `create()` persists to JSON, `list()` reads back, `rename()` updates name, `remove()` deletes entry, `create()` rejects duplicate directory, `findByDirectory()` returns match
**GREEN**: Implement `WorkspaceService` at `src/main/services/workspace.service.ts` — persistence at `~/.local/share/gustav/workspaces.json`, CRUD operations, unique directory constraint. Include `discoverGitRepos()` (moved from RegistryService)
**REFACTOR**: Extract file path constants; ensure error messages are user-facing quality
**Files**: `src/main/services/workspace.service.ts`, `src/main/services/__tests__/workspace.service.test.ts`
**Commit**: `feat: add workspace persistence service with CRUD and git discovery`

### Step 3: Config service reads .gustav

**Complexity**: trivial
**RED**: Update existing config test to assert `.gustav` is read instead of `.wt`
**GREEN**: Change `ConfigService.parse()` to look for `.gustav` instead of `.wt`
**REFACTOR**: Rename `WtConfig` type to `GustavConfig` across codebase
**Files**: `src/main/services/config.service.ts`, `src/main/domain/types.ts`, `src/main/services/session.service.ts`, `src/main/services/worktree.service.ts`
**Commit**: `refactor: rename .wt to .gustav config file and WtConfig to GustavConfig`

### Step 4: Session service — new naming and session types

**Complexity**: complex
**RED**: Write tests for new naming convention: `getSessionName('myworkspace', { type: 'workspace' })` → `myworkspace/_ws`; `getSessionName('myworkspace', { type: 'directory', repoName: 'api' })` → `myworkspace/api/_dir`; `getSessionName('myworkspace', { type: 'worktree', repoName: 'api', branch: 'feat' })` → `myworkspace/api/feat`; standalone: `_standalone/label`. Test `launchWorkspaceSession()` creates claude + shell windows and reads `.gustav`. Test `launchDirectorySession()` creates full session in repo root. Test `launchWorktreeSession()` creates session in worktree path
**GREEN**: Rewrite `SessionService` with `launchWorkspaceSession(workspaceName, workspaceDir, config)`, `launchDirectorySession(workspaceName, repoRoot, config)`, `launchWorktreeSession(workspaceName, repoRoot, branch, workdir, config)`, and `launchStandaloneSession(name, dir)`. Update `getSessionName()` and `kill()` for new naming
**REFACTOR**: Extract common session setup (tmux options, window creation) into private helper
**Files**: `src/main/services/session.service.ts`, `src/main/services/__tests__/session.service.test.ts`
**Commit**: `feat: session service supports workspace, directory, worktree, and standalone session types`

### Step 5: State service — command-based Claude detection

**Complexity**: complex
**RED**: Write tests: `detectClaudeStatus()` finds panes where `pane_current_command` is `claude` (not by window name); returns worst status when multiple panes run claude; detects manually-launched claude in arbitrary windows; returns `none` when no pane runs claude. Update existing state machine tests for new detection method
**GREEN**: Change `detectClaudeStatus()` to call `listPanes` with format including `pane_current_command`, filter for panes running `claude`, capture each, return worst via `worstStatus()`. Update `TmuxPort.listPanes` signature to return structured data including command
**REFACTOR**: Remove window-name matching logic entirely
**Files**: `src/main/services/state.service.ts`, `src/main/services/__tests__/state.service.test.ts`, `src/main/ports/tmux.port.ts`, `src/main/adapters/tmux.adapter.ts`
**Commit**: `feat: detect claude status by pane command instead of window name`

### Step 6: State service — workspace-aware collection

**Complexity**: complex
**RED**: Write tests: `collect()` returns new `AppState` shape with `workspaces` array, each containing workspace metadata and its `sessions`. Sessions grouped by workspace based on tmux session name prefix. Orphan worktrees appear within their workspace's repo group. Default workspace contains standalone sessions. `workspaceStatus` computed as worst status across all sessions in workspace
**GREEN**: Rewrite `StateService.collect()` to: load workspaces from `WorkspaceService`, parse tmux sessions by new naming convention, group into workspace buckets, discover orphan worktrees per repo within each workspace, compute workspace-level status. New `AppState` shape: `{ workspaces: WorkspaceState[], defaultWorkspace: WorkspaceState, windows: WindowInfo[] }` where `WorkspaceState = { workspace: Workspace | null, sessions: SessionTab[], repoGroups: RepoGroupState[], status: ClaudeStatus }`
**REFACTOR**: Remove old `RegistryService` dependency; clean up old `SessionEntry` references
**Files**: `src/main/services/state.service.ts`, `src/main/services/__tests__/state.service.test.ts`, `src/main/domain/types.ts`
**Commit**: `feat: workspace-aware state collection with grouped sessions and computed status`

### Step 7: IPC channels, handlers, and preload

**Complexity**: standard
**RED**: (No unit tests for IPC wiring — verified by integration in later steps)
**GREEN**: Add new channels: `CREATE_WORKSPACE`, `RENAME_WORKSPACE`, `REMOVE_WORKSPACE`, `LIST_WORKSPACES`, `DISCOVER_REPOS`, `CREATE_WORKSPACE_SESSION`, `CREATE_REPO_SESSION`, `CREATE_STANDALONE_SESSION`, `SELECT_DIRECTORY`. Remove old channels: `PIN_PROJECTS`, `UNPIN_PROJECT`, `CREATE_SESSION`, `START_SESSION`. Update `registerHandlers()` with new deps (WorkspaceService). Update preload `index.ts` to expose new API methods. Add TypeScript types for the preload API
**REFACTOR**: Group handler registrations by domain (workspace, session, worktree, window, pty)
**Files**: `src/main/ipc/channels.ts`, `src/main/ipc/handlers.ts`, `src/preload/index.ts`
**Commit**: `feat: IPC channels and preload API for workspace and session management`

### Step 8: Main process wiring

**Complexity**: standard
**RED**: (Verified by app startup)
**GREEN**: Update `src/main/index.ts`: instantiate `WorkspaceService` (replacing `RegistryService`), pass to `StateService` and `registerHandlers()`. Update `WorktreeService` constructor if needed. Remove `RegistryService` instantiation
**REFACTOR**: None needed
**Files**: `src/main/index.ts`
**Commit**: `feat: wire workspace service into main process`

### Step 9: Zustand store — new shape

**Complexity**: standard
**RED**: Write test for `groupByWorkspace()` pure function: groups sessions into workspace buckets, sorts workspace sessions first then repo groups, computes workspace status
**GREEN**: Rewrite `useAppStore` with new shape: `{ workspaces: WorkspaceState[], defaultWorkspace: WorkspaceState, activeSession, windows }`. Rewrite `groupByWorkspace()` replacing `groupByCategory()`. Update `useAppStateSubscription()` and `refreshState()`
**REFACTOR**: Delete `group-by-category.ts` and its tests
**Files**: `src/renderer/hooks/use-app-state.ts`, `src/renderer/lib/group-by-workspace.ts`, `src/renderer/lib/__tests__/group-by-workspace.test.ts`, `src/renderer/lib/group-by-category.ts` (delete), `src/renderer/lib/__tests__/group-by-category.test.ts` (delete)
**Commit**: `feat: zustand store with workspace-aware state shape`

### Step 10: StatusIcon component — animated nerd font symbols

**Complexity**: standard
**RED**: (UI component — manual verification)
**GREEN**: Create `StatusIcon` component replacing `StatusDot`. States: `busy` cycles through nerd font symbols (e.g., `󰄰 󰄱 󰄲 󰄳 ...` or spinner chars) with CSS animation or `useEffect` interval; `action` shows red dot (or nerd font attention symbol); `done` shows green checkmark symbol; `new` shows dim dot; `none` shows nothing. Use semantic colors from shadcn tokens where applicable, ANSI colors (`text-c1`, `text-c3`, etc.) for status-specific coloring per CLAUDE.md rules
**REFACTOR**: Delete `StatusDot.tsx`
**Files**: `src/renderer/components/sidebar/StatusIcon.tsx`, `src/renderer/components/sidebar/StatusDot.tsx` (delete)
**Commit**: `feat: animated nerd font status icon component`

### Step 11: SessionTab component — tab row with type icons

**Complexity**: standard
**RED**: (UI component — manual verification)
**GREEN**: Create `SessionTab` component replacing `SessionEntry`. Display: `StatusIcon` | type icon (nerd font: folder for workspace, git-branch for directory, git-merge for worktree) | session name (truncated) | status text label at end. Click to switch session or start orphan. Hover actions: kill session, remove worktree. Active session highlighted. Use `text-muted-foreground` for secondary text, `bg-muted` for active highlight, `border-accent` for active border per shadcn tokens
**REFACTOR**: Delete `SessionEntry.tsx`
**Files**: `src/renderer/components/sidebar/SessionTab.tsx`, `src/renderer/components/sidebar/SessionEntry.tsx` (delete)
**Commit**: `feat: session tab component with type icons and status display`

### Step 12: Workspace accordion component

**Complexity**: standard
**RED**: (UI component — manual verification)
**GREEN**: Create `WorkspaceAccordion` component. Header shows: expand/collapse chevron, workspace name, workspace-level `StatusIcon`, session count, edit/unpin button (revealed on hover), `+` button to add session. Content: workspace sessions listed first, then `RepoGroup` components for each repo (directory session first, worktrees below, orphans at bottom). Rewrite `RepoGroup` to use `SessionTab` and work within workspace context. For the default workspace (standalone): no edit/unpin, no `+` button, just standalone sessions listed
**REFACTOR**: Simplify `AccordionCategory` or replace entirely with `WorkspaceAccordion`
**Files**: `src/renderer/components/sidebar/WorkspaceAccordion.tsx`, `src/renderer/components/sidebar/RepoGroup.tsx`, `src/renderer/components/sidebar/AccordionCategory.tsx` (delete or repurpose)
**Commit**: `feat: workspace accordion with session groups and controls`

### Step 13: Sidebar rewrite

**Complexity**: complex
**RED**: (UI component — manual verification)
**GREEN**: Rewrite `Sidebar.tsx`: header shows "Workspaces" title + dropdown button (`+` icon). Dropdown offers "New Workspace" and "New Standalone Session". Body: default workspace at top (standalone sessions), then named workspace accordions sorted alphabetically. Each workspace accordion uses `WorkspaceAccordion`. Remove old `ActionBar`
**REFACTOR**: Delete `ActionBar.tsx` if it exists as separate component; clean up unused imports
**Files**: `src/renderer/components/sidebar/Sidebar.tsx`, `src/renderer/components/sidebar/ActionBar.tsx` (delete if exists)
**Commit**: `feat: rewrite sidebar with workspaces layout and creation dropdown`

### Step 14: Dialogs — workspace and session creation

**Complexity**: complex
**RED**: (UI component — manual verification)
**GREEN**: Create `NewWorkspaceDialog`: name input + directory picker (Electron `showOpenDialog`). Validates unique directory. Create `EditWorkspaceDialog`: rename only (directory shown but disabled). Redesign `NewSessionDialog` as multi-step: step 1 picks "Workspace Session" or "Repository Session"; step 2a (workspace) confirms and creates; step 2b (repository) shows discovered repos (greyed out if none found), user picks repo, then chooses "Repository directory" or "New worktree" (with branch input for worktree). Create `NewStandaloneDialog`: picks directory or repository mode. Repository mode: user picks folder with `.git`, then repo root or new worktree. Keep `NewWorktreeDialog`, `RemoveWorktreeDialog`, `CleanWorktreesDialog` — adapt to work with new data model (workspace context)
**REFACTOR**: Remove duplicate dialog logic; extract shared directory picker
**Files**: `src/renderer/components/dialogs/NewWorkspaceDialog.tsx`, `src/renderer/components/dialogs/EditWorkspaceDialog.tsx`, `src/renderer/components/dialogs/NewSessionDialog.tsx` (rewrite), `src/renderer/components/dialogs/NewStandaloneDialog.tsx`, `src/renderer/components/dialogs/NewWorktreeDialog.tsx` (adapt), `src/renderer/components/dialogs/RemoveWorktreeDialog.tsx` (adapt), `src/renderer/components/dialogs/CleanWorktreesDialog.tsx` (adapt)
**Commit**: `feat: workspace and session creation dialogs with multi-step flow`

### Step 15: App.tsx wiring and cleanup

**Complexity**: standard
**RED**: (Verified by app startup and manual testing)
**GREEN**: Update `App.tsx`: replace old dialog state with new dialogs, pass workspace context to session creation, wire up new sidebar callbacks. Remove old `SessionEntry` imports. Ensure all dialog open/close flows work with the new workspace model
**REFACTOR**: Remove any dead code from old model; run through all files for stale imports
**Files**: `src/renderer/App.tsx`
**Commit**: `feat: wire workspace dialogs and sidebar into app shell`

### Step 16: Delete old code

**Complexity**: trivial
**RED**: Verify all tests pass, no references to deleted code remain
**GREEN**: Delete `src/main/services/registry.service.ts`, `src/main/services/__tests__/registry.service.test.ts`. Remove any remaining `SessionEntry` type references (now replaced by `SessionTab`). Remove old IPC channels from constants
**REFACTOR**: Final cleanup pass
**Files**: `src/main/services/registry.service.ts` (delete), `src/main/services/__tests__/registry.service.test.ts` (delete)
**Commit**: `chore: remove legacy registry service and old session entry types`

## Complexity Classification

| Rating | Criteria | Review depth |
|--------|----------|--------------|
| `trivial` | Single-file rename, config change, typo fix, documentation-only | Skip inline review |
| `standard` | New function, test, module, or behavioral change within existing patterns | Spec-compliance + relevant quality agents |
| `complex` | Architectural change, security-sensitive, cross-cutting concern, new abstraction | Full agent suite |

## Pre-PR Quality Gate

- [ ] All tests pass (`npm test`)
- [ ] Type check passes (`npx tsc --noEmit`)
- [ ] App builds (`npm run build`)
- [ ] Manual verification: create workspace, create all session types, verify status detection, verify sidebar layout
- [ ] No absolute font sizes (no `text-[Npx]`, no `font-size: Npx`)
- [ ] Semantic color tokens used (shadcn tokens for UI, ANSI tokens only for status indicators)

## Risks & Open Questions

- **TmuxPort.listPanes change (Step 5):** Adding `pane_current_command` to the format string changes the adapter. The existing tmux.adapter.test.ts may need updating. Need to verify the tmux format string `#{pane_current_command}` works across tmux versions (3.x+)
- **Session naming collision:** The new convention `workspaceName/repoName/branch` uses two slashes. Need to ensure workspace names and repo names never contain `/`. Validate on creation
- **Orphan worktree detection scope:** Currently scans all pinned repos. New model scans repos per workspace (discovered on-the-fly). This means orphan detection needs to discover repos under each workspace dir on every poll — may be slow for deep directory trees. Mitigation: cache discovered repo paths per workspace, refresh on explicit action only
- **No test infrastructure for React components:** Steps 10-15 rely on manual verification. Consider adding Vitest + React Testing Library in a follow-up, but not in scope for this plan
- **Nerd font symbol availability:** The UI assumes GeistMono Nerd Font is available (bundled in a prior commit). Verify the cycling animation symbols render correctly
