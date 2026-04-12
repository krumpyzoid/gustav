# Plan: Sleep / Destroy Session Semantics

**Created**: 2026-04-12
**Branch**: main
**Status**: implemented

## Goal

Replace the single "kill" session action with two distinct lifecycle actions: **sleep** (kill tmux, keep persisted entry with claudeSessionId, show as sleeping in sidebar) and **destroy** (kill tmux, remove persisted entry, disappear from sidebar). Sleeping sessions must be visible in the sidebar for all session types — including workspace sessions that aren't tied to pinned repos.

## Spec Reference

`docs/specs/sleep-destroy-sessions.md`

## Acceptance Criteria

- [ ] Clicking the sleep button (Moon icon, warning/yellow) on an active session kills tmux but keeps the persisted entry
- [ ] Sleeping sessions appear in the sidebar with Moon icon and reduced opacity for all session types
- [ ] Sleeping workspace/standalone sessions are visible (not just pinned-repo directory sessions)
- [ ] Clicking a sleeping session wakes it and resumes Claude via `--resume <id>`
- [ ] Clicking the destroy button (Trash icon, destructive/red) kills tmux AND removes the persisted entry
- [ ] Destroying a sleeping session removes it from the sidebar
- [ ] The destroy button is available on both active and sleeping sessions
- [ ] App restart restores sleeping sessions via `restoreAll()`
- [ ] Old `killSession` API is replaced with `sleepSession` / `destroySession`
- [ ] All existing tests pass; new IPC handlers are tested

## Steps

### Step 1: Rename IPC channel and add DESTROY_SESSION channel

**Complexity**: standard
**RED**: Write tests for the new `SLEEP_SESSION` and `DESTROY_SESSION` IPC handlers. Sleep handler: kills tmux session, does NOT call `removeSession`. Destroy handler: kills tmux session (if running), calls `removeSession`. Since IPC handlers aren't directly unit-tested today, write tests for the behavior by testing through the handler registration pattern (or test the underlying logic). Alternatively, add targeted tests in a new `handlers.test.ts` or extend session.service tests for the kill-vs-destroy distinction.
**GREEN**:
  - In `channels.ts`: rename `KILL_SESSION` to `SLEEP_SESSION`, add `DESTROY_SESSION`
  - In `handlers.ts`: rename the existing `KILL_SESSION` handler to `SLEEP_SESSION` (it already just kills tmux without removing the persisted entry). Add a new `DESTROY_SESSION` handler that kills tmux + calls `workspaceService.removeSession()`.
  - In `preload/index.ts`: rename `killSession` to `sleepSession`, add `destroySession`
  - In `preload/api.d.ts`: update type definitions accordingly
**REFACTOR**: None needed
**Files**: `src/main/ipc/channels.ts`, `src/main/ipc/handlers.ts`, `src/preload/index.ts`, `src/preload/api.d.ts`
**Commit**: `feat: rename kill to sleep, add destroy session IPC channel`

### Step 2: Surface sleeping sessions in StateService

**Complexity**: complex
**RED**: Write tests in `state.service.test.ts` for sleeping session visibility:
  1. A persisted workspace session with no live tmux session appears as `active: false` in the workspace's sessions list
  2. A persisted directory session with no live tmux session appears as `active: false` in the repo group (alongside the pinned-repo placeholder behavior)
  3. A persisted worktree session with no live tmux session appears as `active: false` in the repo group
  4. A persisted session that IS live in tmux does NOT create a duplicate sleeping entry
  5. Sleeping sessions have `status: 'none'`
**GREEN**: In `StateService.collectWorkspaces()`, after building session tabs from live tmux sessions, iterate each workspace's `ws.sessions` (persisted entries). For each persisted session whose `tmuxSession` is NOT in the live tmux sessions set, inject a sleeping `SessionTab` (`active: false`, `status: 'none'`). Parse the tmux session name to determine `type`, `repoName`, `branch`, and `workspaceId` — reuse the same parsing logic already in `collectWorkspaces`. For workspace-type sleeping sessions, add to `wsSessions`. For directory/worktree-type, add to the appropriate repo group.
**REFACTOR**: Extract the tmux session name parsing into a helper function to avoid duplication between live and sleeping session parsing.
**Files**: `src/main/services/state.service.ts`, `src/main/services/__tests__/state.service.test.ts`
**Commit**: `feat: surface sleeping sessions in state model`

### Step 3: Handle waking workspace sessions via click

**Complexity**: standard
**RED**: This is a UI change. Verify by manual testing after implementation.
**GREEN**: In `SessionTab.tsx`, update `handleClick()` to handle sleeping workspace sessions. Currently, `if (isInactive) return;` blocks all non-directory/non-worktree inactive sessions. Add a handler before that guard:
```
if (isInactive && tab.type === 'workspace' && workspaceName) {
  // Wake the workspace session
  const result = await window.api.createWorkspaceSession(workspaceName, workspaceDir, label);
  ...
}
```
This requires the `SessionTab` props to include `workspaceDir` so it can call `createWorkspaceSession`. Update the `Props` interface and the `WorkspaceAccordion` to pass the workspace directory down.
**REFACTOR**: None needed
**Files**: `src/renderer/components/sidebar/SessionTab.tsx`, `src/renderer/components/sidebar/WorkspaceAccordion.tsx`
**Commit**: `feat: clicking sleeping workspace sessions wakes them`

### Step 4: Update SessionTab UI — sleep and destroy buttons

**Complexity**: standard
**RED**: This is a UI change. Verify by manual testing.
**GREEN**: In `SessionTab.tsx`:
  1. Replace the `✕` kill button with a Moon icon sleep button:
     - Import `Moon` and `Trash2` from `lucide-react` (Moon is already imported)
     - Use `Moon` icon with warning/yellow color (`text-c3` or `text-yellow-500`)
     - Title: "Put to sleep"
     - Calls `window.api.sleepSession(tab.tmuxSession)` (was `killSession`)
     - Only shown on **active** sessions
  2. Add a Trash destroy button:
     - Use `Trash2` icon with destructive/red variant
     - Title: "Destroy session"
     - Calls `window.api.destroySession(tab.tmuxSession)`
     - Shown on **both active and sleeping** sessions (always visible on hover)
  3. Rename `handleKill` to `handleSleep`, add `handleDestroy`
**REFACTOR**: None needed
**Files**: `src/renderer/components/sidebar/SessionTab.tsx`
**Commit**: `feat: sleep (moon/yellow) and destroy (trash/red) buttons in sidebar`

### Step 5: Update KILL_WINDOW handler for consistency

**Complexity**: trivial
**RED**: N/A
**GREEN**: The `KILL_WINDOW` handler currently calls `removeSession` when killing the last window (destroying the session). This should be updated to match the new semantics: killing the last window = sleep (not destroy). The persisted entry should be kept. Remove the `removeSession` call from the `windows.length <= 1` branch. If the user wants to fully destroy, they use the destroy button explicitly.
**REFACTOR**: None needed
**Files**: `src/main/ipc/handlers.ts`
**Commit**: `fix: killing last window sleeps session instead of destroying`

## Complexity Classification

| Rating | Criteria | Review depth |
|--------|----------|--------------|
| `trivial` | Single-file rename, config change, typo fix | Skip inline review |
| `standard` | New function, test, module, or behavioral change within existing patterns | Spec-compliance + relevant quality agents |
| `complex` | Architectural change, cross-cutting concern, new abstraction | Full agent suite |

## Pre-PR Quality Gate

- [ ] All tests pass (`pnpm test`)
- [ ] Type check passes (`npx tsc --noEmit`)
- [ ] Manual test: sleep a session → verify it appears sleeping in sidebar → click to wake → Claude resumes
- [ ] Manual test: sleep a workspace session → verify it appears sleeping → wake it
- [ ] Manual test: destroy an active session → verify it disappears
- [ ] Manual test: destroy a sleeping session → verify it disappears
- [ ] Manual test: restart Gustav → sleeping sessions are restored

## Risks & Open Questions

- **Workspace session wake requires `workspaceDir`**: The `SessionTab` component currently doesn't receive the workspace directory. `WorkspaceAccordion` has `ws.workspace.directory` — it needs to thread this through to `SessionTab` for workspace-type sessions. Step 3 handles this.
- **Standalone sessions**: Standalone sessions (not in any workspace) don't have a `workspaceService.removeSession` path since they're not in `workspaces.json`. The destroy handler should gracefully handle this (just kill tmux). The sleep behavior already works since standalone sessions aren't persisted.
- **Duplicate sleeping entries for pinned repos**: For directory sessions of pinned repos, `collectWorkspaces` already creates inactive placeholder entries. The sleeping session merge in Step 2 must avoid creating duplicates — check if a matching entry already exists before injecting.
