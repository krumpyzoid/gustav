# Plan: Intra-workspace drag-and-drop reordering

**Created**: 2026-04-09
**Branch**: main
**Status**: implemented

## Goal

Extend drag-and-drop to support reordering at four levels: workspace headers, workspace sessions, repo groups (by repo name), and sessions within a repo. Persist all ordering in `workspaces.json`. Restrict workspace dragging to the header only.

## Acceptance Criteria

- [ ] Workspaces only draggable by header, not by child content
- [ ] Workspace sessions reorderable within their list
- [ ] Repo groups reorderable by dragging repo name
- [ ] Repo sessions reorderable within their repo
- [ ] No cross-repo or cross-workspace dragging (enforced by drag type discriminator)
- [ ] All ordering persists to `workspaces.json` and survives restart
- [ ] New sessions/repos not in persisted ordering appear at the end
- [ ] Terminal refocuses after every drag
- [ ] Alt+Up/Down respects the persisted visual order
- [ ] Typecheck and build pass

## Steps

### Step 1: Add ordering field to Workspace type and persistence

**Complexity**: standard
**RED**: Write test in `workspace.service.test.ts` — calling `updateOrdering(id, ordering)` persists and `list()` returns workspace with ordering
**GREEN**: Add `ordering?: { sessions?: string[]; repos?: string[]; repoSessions?: Record<string, string[]> }` to `Workspace` type. Add `updateOrdering()` to `WorkspaceService`
**REFACTOR**: None needed
**Files**: `src/main/domain/types.ts`, `src/main/services/workspace.service.ts`, `src/main/services/__tests__/workspace.service.test.ts`
**Commit**: `feat: add ordering field to workspace type and persistence`

### Step 2: Apply persisted ordering in state service

**Complexity**: standard
**RED**: Write test in `state.service.test.ts` — given a workspace with ordering, `collectWorkspaces` returns sessions/repos/repoSessions in that order. Items not in ordering appear at end.
**GREEN**: In `collectWorkspaces`, after grouping, sort workspace sessions, repo groups, and repo sessions using the workspace's `ordering` field. Unrecognized items appended.
**REFACTOR**: Extract a `applyOrder(items, orderKeys, keyFn)` helper
**Files**: `src/main/services/state.service.ts`, `src/main/services/__tests__/state.service.test.ts`
**Commit**: `feat: apply persisted ordering in state service`

### Step 3: Add IPC channel for reorder-within-workspace

**Complexity**: trivial
**RED**: N/A (IPC wiring)
**GREEN**: Add `REORDER_WITHIN_WORKSPACE` channel. Handler receives `(workspaceId, ordering)` and calls `workspaceService.updateOrdering()`. Add to preload API.
**REFACTOR**: None needed
**Files**: `src/main/ipc/channels.ts`, `src/main/ipc/handlers.ts`, `src/preload/api.d.ts`, `src/preload/index.ts`
**Commit**: `feat: add reorder-within-workspace IPC channel`

### Step 4: Restrict workspace drag to header only

**Complexity**: standard
**RED**: Manual verification — dragging session inside workspace must not move workspace
**GREEN**: In `DraggableWorkspace`, accept a `dragHandleRef` and pass it as `dragHandle` to `draggable()`. In `WorkspaceAccordion`, pass the header button ref up. Alternatively, expose a ref from WorkspaceAccordion's header.
**REFACTOR**: Consider merging DraggableWorkspace into WorkspaceAccordion if the separation no longer helps
**Files**: `src/renderer/components/sidebar/DraggableWorkspace.tsx`, `src/renderer/components/sidebar/WorkspaceAccordion.tsx`
**Commit**: `fix: restrict workspace drag to header only`

### Step 5: Add drag-and-drop for workspace sessions

**Complexity**: standard
**RED**: Manual verification — drag workspace session to reorder, order persists
**GREEN**: Create a generic `DraggableSortItem` component (or inline in SessionTab) that attaches `draggable` + `dropTargetForElements` with a `dragType` discriminator. Use `dragType: 'ws-session'` and scope `canDrop` to same workspace + same type. On drop, compute new order and call `reorderWithinWorkspace` IPC.
**REFACTOR**: Extract shared drag indicator logic if duplicated from DraggableWorkspace
**Files**: `src/renderer/components/sidebar/WorkspaceAccordion.tsx`, `src/renderer/components/sidebar/SessionTab.tsx`
**Commit**: `feat: drag-and-drop reordering for workspace sessions`

### Step 6: Add drag-and-drop for repo groups

**Complexity**: standard
**RED**: Manual verification — drag repo name to reorder repos within workspace
**GREEN**: Make the RepoGroup header a drag handle. Use `dragType: 'repo-group'` scoped to same workspace. On drop, compute new repo order and call `reorderWithinWorkspace`.
**REFACTOR**: None needed
**Files**: `src/renderer/components/sidebar/WorkspaceAccordion.tsx`
**Commit**: `feat: drag-and-drop reordering for repo groups`

### Step 7: Add drag-and-drop for repo sessions

**Complexity**: standard
**RED**: Manual verification — drag session within repo to reorder, cannot drag to different repo
**GREEN**: Use `dragType: 'repo-session'` scoped to same workspace + same repoName. On drop, compute new session order and call `reorderWithinWorkspace`.
**REFACTOR**: Deduplicate reorder callback logic across the three session-level drag handlers
**Files**: `src/renderer/components/sidebar/WorkspaceAccordion.tsx`, `src/renderer/components/sidebar/SessionTab.tsx`
**Commit**: `feat: drag-and-drop reordering for repo sessions`

### Step 8: Ensure terminal refocus after all drags

**Complexity**: trivial
**RED**: N/A
**GREEN**: Ensure all new draggable `onDrop` callbacks call `focusTerminal()`
**REFACTOR**: None needed
**Files**: Various drag components
**Commit**: Folded into steps 5-7

## Pre-PR Quality Gate

- [ ] All tests pass
- [ ] Type check passes
- [ ] Linter passes
- [ ] Build succeeds
- [ ] Manual test: reorder at each level, restart, verify persistence

## Risks & Open Questions

- **Drag indicator styling**: Current accent-colored border indicator works for workspaces. Same style should be consistent across all drag levels.
- **Standalone workspace**: Excluded from reordering (no persisted config). Standalone sessions stay in default order.
- **Performance**: `updateOrdering` writes to disk on every drop. Acceptable for low-frequency action. If needed, debounce later.
