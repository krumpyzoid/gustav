# Plan: Sidebar project pinning and category grouping

**Created**: 2026-04-06
**Branch**: feat/architecture-overhaul
**Status**: approved

## Goal

Replace the auto-discovered flat repo list with explicit project pinning (add via "+" / remove via "Unpin") and three collapsible category accordions (STANDALONE, ACTIVE, IDLE). Remove auto-discovery of repos from tmux sessions — only pinned repos appear in ACTIVE/IDLE.

## Acceptance Criteria

- [ ] "+" button at top of sidebar opens native folder picker and pins git repos
- [ ] Non-git folder selection recursively discovers git repos (max 3 levels)
- [ ] Hovering a project group reveals "Unpin" icon; clicking removes it from sidebar and config
- [ ] Pinned projects persist across app restarts
- [ ] Duplicate repos are not added twice
- [ ] Auto-discovery from tmux sessions is removed
- [ ] Sidebar renders STANDALONE / ACTIVE / IDLE accordion categories
- [ ] IDLE collapsed by default; STANDALONE and ACTIVE expanded
- [ ] Accordion headers toggle collapse/expand on click
- [ ] Projects move between ACTIVE and IDLE as sessions start/stop
- [ ] Empty categories are hidden

## Steps

### Step 0: Install vitest and configure test runner

**Complexity**: standard
**What**: Install `vitest` as a dev dependency. Create `vitest.config.ts` at project root targeting the main process code (Node environment, resolve from `tsconfig.main.json` paths). Add `"test"` script to `package.json`. Verify with a trivial passing test.
**RED**: N/A (infrastructure)
**GREEN**: `npm test` runs and exits cleanly
**REFACTOR**: None needed
**Files**: `package.json`, `vitest.config.ts`
**Commit**: `chore: add vitest test runner`

### Step 1: Add recursive git discovery to `RegistryService`

**Complexity**: standard
**What**: Add a `discoverGitRepos(folderPath: string, maxDepth: number): string[]` method to `RegistryService` (or a standalone function) that checks if a folder is a git repo (has `.git`), and if not, recursively walks subdirectories (skipping `node_modules`, `.git`, and hidden dirs) up to `maxDepth` levels, collecting paths that contain `.git`. Also add a `pin(folderPath: string)` method that derives the repo name from the folder basename and saves it, and a `pinMany(paths: string[])` that deduplicates against existing entries.
**RED**: Write tests for `discoverGitRepos`:
  - single git repo returns `[path]`
  - non-git folder with nested repos returns all of them
  - depth > maxDepth is not traversed
  - `node_modules` and hidden dirs are skipped
  - already-pinned repos are not duplicated by `pinMany`
**GREEN**: Implement discovery + pin methods
**REFACTOR**: Extract directory walking if needed
**Files**: `src/main/services/registry.service.ts`, `src/main/services/__tests__/registry.service.test.ts`
**Commit**: `feat: add recursive git discovery and pin/unpin to RegistryService`

### Step 2: Add `PIN_PROJECTS` and `UNPIN_PROJECT` IPC channels + handlers

**Complexity**: standard
**What**: Add two new IPC channels. `PIN_PROJECTS` opens `dialog.showOpenDialog`, calls `discoverGitRepos` on the result, pins them via `registryService.pinMany()`, and returns updated state. `UNPIN_PROJECT` calls `registryService.remove()` and returns updated state. Remove `REMOVE_REPO` channel.
**RED**: Write handler tests with mocked dialog + registry (verify correct channel wiring, dialog options, delegation to registry)
**GREEN**: Implement handlers
**REFACTOR**: None needed
**Files**: `src/main/ipc/channels.ts`, `src/main/ipc/handlers.ts`, `src/main/ipc/__tests__/handlers.test.ts`
**Commit**: `feat: add pin/unpin IPC handlers with native folder picker`

### Step 3: Update preload bridge and type declarations

**Complexity**: trivial
**What**: Replace `removeRepo()` with `pinProjects()` and `unpinProject(repoName)` in the preload API. Update `api.d.ts` types to match.
**RED**: N/A (type-only change, verified by `tsc`)
**GREEN**: Update preload + types
**REFACTOR**: None needed
**Files**: `src/preload/index.ts`, `src/preload/api.d.ts`
**Commit**: `feat: expose pinProjects and unpinProject in preload API`

### Step 4: Remove auto-discovery from `StateService.collect()`

**Complexity**: standard
**What**: In `StateService.collect()`, remove the block (lines 66-79) that auto-registers repos by querying tmux pane paths. The registry becomes purely user-driven. Tmux sessions for non-pinned repos with `repo/branch` naming will have their entries grouped by repo name but the repo won't be registered — they show up under the repo name in ACTIVE only while the session is alive.
**RED**: Write tests for `StateService.collect()`:
  - pinned repo with active session → entry has correct repo name
  - tmux session for non-pinned repo → entry still uses parsed repo name (not forced to standalone)
  - `registry.save()` is never called during `collect()`
**GREEN**: Remove auto-discovery block
**REFACTOR**: Clean up unused variables
**Files**: `src/main/services/state.service.ts`, `src/main/services/__tests__/state.service.test.ts`
**Commit**: `refactor: remove auto-discovery of repos from tmux sessions`

### Step 5: Add sidebar grouping logic as a pure function

**Complexity**: standard
**What**: Extract a pure function `groupByCategory(entries, pinnedRepos)` that takes `SessionEntry[]` and the repos map, returns `{ standalone: SessionEntry[], active: Map<string, SessionEntry[]>, idle: string[] }`. This is the core classification logic — testable without React.
- STANDALONE: entries with `repo === 'standalone'`
- ACTIVE: repos where ≥1 entry has `tmuxSession !== null` (includes non-pinned repos with active sessions)
- IDLE: pinned repos not appearing in ACTIVE (zero entries or all `tmuxSession === null`)
**RED**: Write tests:
  - standalone entries grouped correctly
  - repo with active session → ACTIVE
  - pinned repo with no entries → IDLE
  - pinned repo with only orphaned worktrees → IDLE
  - repo moves from IDLE → ACTIVE when session appears
  - empty categories return empty collections
**GREEN**: Implement `groupByCategory`
**REFACTOR**: None needed
**Files**: `src/renderer/lib/group-by-category.ts`, `src/renderer/lib/__tests__/group-by-category.test.ts`
**Commit**: `feat: add groupByCategory pure function for sidebar classification`

### Step 6: Create `AccordionCategory` component

**Complexity**: standard
**What**: New React component — collapsible section with a header (uppercase label, chevron icon from lucide-react), and children slot. Accepts `defaultExpanded` prop. Uses `useState` for collapse toggle (ephemeral). Hidden when no children.
**RED**: N/A (presentational component — verified visually + by type check)
**GREEN**: Implement component
**REFACTOR**: None needed
**Files**: `src/renderer/components/sidebar/AccordionCategory.tsx`
**Commit**: `feat: add AccordionCategory sidebar component`

### Step 7: Replace "✕" with "Unpin" in `RepoGroup` and add "+" to sidebar top

**Complexity**: standard
**What**: In `RepoGroup.tsx`, replace the "✕" delete button with a `PinOff` icon (lucide-react) that calls `window.api.unpinProject(repo)`. Show on group hover for all non-standalone repos (remove the `!hasActive` guard). In `Sidebar.tsx`, add a "+" button at the top that calls `window.api.pinProjects()`.
**RED**: N/A (UI wiring — verified visually + by type check)
**GREEN**: Update RepoGroup + Sidebar
**REFACTOR**: None needed
**Files**: `src/renderer/components/sidebar/RepoGroup.tsx`, `src/renderer/components/sidebar/Sidebar.tsx`
**Commit**: `feat: add pin button to sidebar header and unpin icon to repo groups`

### Step 8: Restructure `Sidebar.tsx` with category accordions

**Complexity**: standard
**What**: Replace the flat group list with three `AccordionCategory` sections using `groupByCategory`. Render order: STANDALONE → ACTIVE → IDLE. IDLE gets `defaultExpanded={false}`. Empty categories not rendered. IDLE repos with no entries still render as a `RepoGroup` with just the header (so user can see them and unpin).
**RED**: N/A (integration of tested grouping logic into UI)
**GREEN**: Wire `groupByCategory` + `AccordionCategory` in Sidebar
**REFACTOR**: Remove old `sortEntries` function if fully replaced
**Files**: `src/renderer/components/sidebar/Sidebar.tsx`
**Commit**: `feat: group sidebar into STANDALONE / ACTIVE / IDLE accordions`

### Step 9: Smoke test and polish

**Complexity**: trivial
**What**: Run the app and verify all acceptance criteria:
1. "+" → folder picker → pin a git repo → appears in sidebar
2. "+" → pick parent folder → recursive discovery
3. Hover repo → Unpin icon → click → removed
4. Restart app → pinned repos persist
5. STANDALONE / ACTIVE / IDLE grouping correct
6. IDLE collapsed by default
7. Toggle accordions
8. Start/kill session → project moves between ACTIVE ↔ IDLE
9. Empty categories hidden
**Files**: none (manual verification)
**Commit**: none

## Pre-PR Quality Gate

- [ ] `npm test` passes (all unit tests green)
- [ ] Type check passes (`npx tsc --noEmit`)
- [ ] App builds (`npm run build`)
- [ ] All acceptance criteria verified manually
- [ ] `/code-review --changed` passes

## Risks & Open Questions

- **Recursive discovery performance**: Walking 3 levels in a large tree could be slow. Mitigation: skip `node_modules`, `.git`, hidden dirs during traversal.
- **Handler tests with Electron dialog**: `dialog.showOpenDialog` needs to be mocked in tests since it requires a BrowserWindow. Tests will mock the dialog module.
- **Tmux sessions for non-pinned repos**: Sessions named `repo/branch` where the repo isn't pinned will still show under ACTIVE with the parsed repo name while running. This is intentional — they just won't persist to IDLE when the session ends.
