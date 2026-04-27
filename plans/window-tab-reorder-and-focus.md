# Plan: Window Tab Reorder + Focus on Create

**Created**: 2026-04-27
**Branch**: main
**Status**: approved
**Spec**: `specs/window-tab-reorder-and-focus.md`

## Goal

Add drag-and-drop reordering to the active session's window-tab strip (`TabBar.tsx`) — Gustav-side only, tmux untouched — and focus the terminal after creating a new window tab so the user can immediately type into it. Per D1, ship as two logical commits at push time even though the build produces per-step commits.

## Acceptance Criteria

- [ ] AC1 — Drag any tab to any other tab on the left or right edge; the tab strip renders the new order.
- [ ] AC2 — Reorder, switch to another session and back: the new order is shown.
- [ ] AC3 — Reorder, restart Gustav, reattach session: the new order is shown.
- [ ] AC4 — After reorder, `tmux list-windows -t <session>` reports the same indices and order as before (tmux untouched).
- [ ] AC5 — Active window unchanged across a reorder.
- [ ] AC6 — Click without drag still calls `selectWindow`; focus stays in terminal.
- [ ] AC7 — Drop indicator (left/right edge) renders on the hovered target tab.
- [ ] AC8 — After dropping, the xterm terminal is the focused element.
- [ ] AC9 — After `handleAdd` resolves successfully, the terminal is the focused element.
- [ ] AC10 — `handleAdd` early-return for empty input does not call `focusTerminal`.
- [ ] AC11 — Newly-created windows append to the visual order.
- [ ] AC12 — Closed windows are dropped from the saved order.
- [ ] AC13 — Externally-created windows append on the next reconcile.
- [ ] AC15 — Existing `TabBar` behaviors (add, kill, click-switch, sleep on last close) continue to work.

(Spec AC14 is satisfied by the per-step tests below.)

## Steps

### Step 1: Make `snapshotSessionWindows` preserve the persisted order

**Why first:** every IPC handler that mutates session state calls `snapshotAndPersist`, which calls this function. Today it rewrites `PersistedSession.windows` in tmux-index order, which would clobber any saved visual order on the next select/new/kill. Fixing this first means the rest of the plan can rely on `PersistedSession.windows` as the canonical visual order.

**Complexity**: standard
**RED**: Extend `src/main/ipc/__tests__/snapshot-windows.test.ts` with cases:
1. Persisted order `[A, B, C]`, live tmux order `[B, A, C]` → merged is `[A, B, C]` (saved order wins).
2. Persisted `[B, A]`, live `[A, B, C]` → merged is `[B, A, C]` (saved first, new at end).
3. Persisted `[A, B, C]`, live `[A, C]` → merged is `[A, C]` (killed window dropped).
4. Persisted empty, live `[A, B]` → merged is `[A, B]` (no order to apply).
**GREEN**: In `src/main/ipc/snapshot-windows.ts`, change the merging logic:
- Build a `liveByName: Map<string, …>` and a `seen: Set<string>`.
- First pass: for each `existingSpec` in order, look up `liveByName`; if present, build the merged spec (re-using the existing kind/args/claudeSessionId/directory logic) and push.
- Second pass: for each live window not yet seen, infer kind from process and push.
**REFACTOR**: Extract `buildMergedSpec(win, existingSpec, pane, shell)` if the two passes share enough body; otherwise leave inline.
**Files**: `src/main/ipc/snapshot-windows.ts`, `src/main/ipc/__tests__/snapshot-windows.test.ts`
**Commit**: `refactor: snapshotSessionWindows preserves persisted window order`

### Step 2: Add `setSessionWindowOrder` to `WorkspaceService` + new IPC channel

**Complexity**: standard
**RED**:
- In `src/main/services/__tests__/workspace.service.test.ts`, add tests:
  1. `setSessionWindowOrder(workspaceId, tmuxSession, ['B', 'A', 'C'])` reorders the persisted session's `windows` array so names match the new order.
  2. Names not present in the persisted session are ignored.
  3. Persisted names not in `names` keep their relative order and are appended at the end.
  4. Calling on an unknown workspace or session is a no-op (or throws — pick "no-op" since concurrent kills could cause a race).
**GREEN**:
- Add `async setSessionWindowOrder(workspaceId, tmuxSession, names)` to `src/main/services/workspace.service.ts` using the existing `enqueue` serialization. Read the workspace, find the session, build the reordered `windows` array, persist.
- Add `SET_WINDOW_ORDER: 'set-window-order'` to `src/main/ipc/channels.ts`.
- Add `setWindowOrder(session: string, names: string[]): Promise<Result<void>>` to `src/preload/index.ts` and `src/preload/api.d.ts`.
- In `src/main/ipc/handlers.ts`, add a handler that resolves the workspace via `findBySessionPrefix`, validates `Array.isArray(names) && names.every(n => typeof n === 'string')`, calls `workspaceService.setSessionWindowOrder(...)`, returns `ok(undefined)` on success or `err(...)` on validation failure.
**REFACTOR**: None.
**Files**: `src/main/services/workspace.service.ts`, `src/main/services/__tests__/workspace.service.test.ts`, `src/main/ipc/channels.ts`, `src/main/ipc/handlers.ts`, `src/preload/index.ts`, `src/preload/api.d.ts`
**Commit**: `feat: setSessionWindowOrder IPC and workspace-service method`

### Step 3: Centralize "tmux windows in persisted visual order" for the renderer

**Why:** there are 4 sites in main that hand `WindowInfo[]` back to the renderer (`state.service.ts:309`, `SWITCH_SESSION`, `WAKE_SESSION`, `SELECT_WINDOW`). All currently use `tmux.listWindows(...)` directly, which returns tmux-index order. Without this step, the renderer would see tmux's order and Step 4's optimistic update would be overwritten on the next IPC.

**Complexity**: standard
**RED**: Add `src/main/ipc/__tests__/apply-persisted-window-order.test.ts` (or place tests under `domain/__tests__/` if the helper lives there):
1. Live `[A,B,C]`, persisted `[C,A,B]` → returns `[C,A,B]` with `active` flags preserved.
2. Live `[A,B,C]`, persisted `[]` → returns `[A,B,C]` unchanged (no order to apply).
3. Live `[A,B,C]`, persisted `[B]` → returns `[B,A,C]` (persisted first, extras appended).
4. Live `[A,B]`, persisted `[A,B,C]` → returns `[A,B]` (no phantom entries).
**GREEN**:
- Create `src/main/ipc/apply-persisted-window-order.ts` exporting `applyPersistedWindowOrder(live: WindowInfo[], persisted: WindowSpec[]): WindowInfo[]`.
- In `handlers.ts`, write a small helper `getOrderedWindows(session)` that calls `tmux.listWindows`, looks up the persisted session via `findBySessionPrefix`+`getPersistedSessions`, and returns `applyPersistedWindowOrder(...)`. Call it from `SWITCH_SESSION`, `WAKE_SESSION`, and `SELECT_WINDOW` handlers in place of the bare `tmux.listWindows`.
- In `state.service.ts:309`, do the same: replace the direct `tmux.listWindows(activeSession)` with the helper (inject `workspaceService` if not already available).
**REFACTOR**: None.
**Files**: `src/main/ipc/apply-persisted-window-order.ts` (new), `src/main/ipc/__tests__/apply-persisted-window-order.test.ts` (new), `src/main/ipc/handlers.ts`, `src/main/services/state.service.ts`
**Commit**: `feat: return windows to renderer in persisted visual order`

### Step 4: Wire drag-and-drop and `setWindowOrder` IPC into `TabBar`

**Complexity**: standard
**RED**: Create `src/renderer/components/terminal/__tests__/TabBar.test.tsx` (no test file exists today). Apply the same SortableItem-mock pattern used in `DefaultTabsList.test.tsx`:
1. Render `TabBar` with three windows; each tab is wrapped in a (mocked) `SortableItem` with `dragType="window-tab"`, `scope="window-tabs:<session>"`, and an `onDropEffect` set to `focusTerminal`.
2. Firing `onReorder('Tests', 'Logs', 'top')` from the mock invokes `window.api.setWindowOrder(activeSession, ['Editor','Tests','Logs'])` (use a mocked `window.api`) and optimistically calls `setWindows` with the new order.
3. Click on a tab without a drag still calls `window.api.selectWindow` (the existing behaviour).
4. The active flag is preserved across reorder.
**GREEN**: In `src/renderer/components/terminal/TabBar.tsx`:
- Import `SortableItem`, `reorderList`, `focusTerminal`.
- Build `handleReorder(draggedName, targetName, edge)`:
  ```ts
  const names = windows.map(w => w.name);
  const next = reorderList(names, draggedName, targetName, edge);
  setWindows(next.map(name => windows.find(w => w.name === name)!));
  await window.api.setWindowOrder(activeSession, next);
  ```
- Wrap each tab `<button>` in a `SortableItem` with: `dragType="window-tab"`, `itemId={w.name}`, `scope={`window-tabs:${activeSession}`}`, `onReorder={handleReorder}`, `onDropEffect={focusTerminal}`. No `dragHandleRef` (drag-from-anywhere on the tab body, per D2).
- Keep all existing per-tab styling (active border, close button, app-region attributes) inside the `SortableItem`.
**REFACTOR**: If the per-tab JSX gets long, extract a small `<WindowTab>` sub-component (mirrors the `<TabRow>` pattern from `DefaultTabsList`).
**Files**: `src/renderer/components/terminal/TabBar.tsx`, `src/renderer/components/terminal/__tests__/TabBar.test.tsx`
**Commit**: `feat: drag-and-drop reorder for window tabs`

### Step 5: Focus terminal after creating a new window tab

**Complexity**: trivial
**RED**: Add a test in the same `TabBar.test.tsx` file:
1. With `window.api.newWindow` mocked to resolve, simulate clicking `+`, typing `Logs`, and pressing Enter. Assert that `focusTerminal` (mocked) is called once after the IPC resolves.
2. With empty input ('') and Enter pressed, assert `focusTerminal` is NOT called and `newWindow` is NOT called.
**GREEN**: In `TabBar.handleAdd`, after `await window.api.newWindow(...)`, call `focusTerminal()`.
**REFACTOR**: None.
**Files**: `src/renderer/components/terminal/TabBar.tsx`, `src/renderer/components/terminal/__tests__/TabBar.test.tsx`
**Commit**: `feat: focus terminal after creating a new window tab`

### Step 6: Manual UI verification

**Complexity**: trivial (verification only — no code).
**Procedure**: `npm run dev`. Confirm:
- Drag a window tab past another tab (left and right edges); order updates.
- Drop returns focus to the terminal — typing immediately reaches the active pane.
- Click a tab without dragging still switches windows; focus stays in terminal.
- Create a new tab via `+` and Enter; immediately type into it without clicking.
- Reorder, switch sessions, switch back: order is preserved.
- Reorder, close Gustav, reopen, reattach the session: order is preserved.
- `tmux list-windows -t <session>` from outside confirms tmux indices unchanged.
- `prefix-N` keyboard navigation behaviour is unchanged (Gustav already blocks these — confirm no regression in input handling).
- Sidebar workspace/session drag still works.
**Commit**: none.

## Complexity Classification

| Step | Rating | Review depth |
|------|--------|--------------|
| 1 | standard | Spec-compliance + structure-review (changing a merging algorithm) + test-review |
| 2 | standard | Spec-compliance + security-review (new IPC accepting names from renderer) + test-review |
| 3 | standard | Spec-compliance + structure-review (4 call sites; helper boundary matters) |
| 4 | standard | Spec-compliance + js-fp-review + a11y-review (drag-anywhere on a button is a click+drag combo — verify no role/keyboard regressions) + test-review |
| 5 | trivial | Skip inline; covered by final `/code-review --changed` |
| 6 | trivial | Manual only |

## Pre-PR Quality Gate

- [ ] All tests pass (`npm test`)
- [ ] Renderer typecheck passes (`npx tsc --noEmit -p tsconfig.renderer.json`) — count ≤ baseline (currently 55)
- [ ] Main typecheck passes (`npx tsc --noEmit -p tsconfig.main.json`)
- [ ] `/code-review --changed` passes
- [ ] Step 6 manual verification completed
- [ ] No tmux mutation introduced (`grep -rn "move-window\|swap-window" src/main` is empty)
- [ ] Spec consistency gate still PASS (`specs/window-tab-reorder-and-focus.md` § 6)
- [ ] Squash to **two commits at push time per D1**: one for the reorder feature (Steps 1–4), one for the focus-on-new-tab fix (Step 5).

## Risks & Open Questions

- **R1 — Reconciliation race when a window is killed mid-reorder.** If the user drops a tab while a separate `kill-window` is in flight, the optimistic local order may briefly include a name that no longer exists. Mitigation: the next IPC response (driven by `snapshotAndPersist` + `getOrderedWindows`) is the canonical source of truth and the renderer will overwrite. Acceptable.
- **R2 — Drag-anywhere on a tab `<button>` may conflict with the existing `onMouseDown(e) => e.preventDefault()`.** Resolved at spec time (D3) by analogy to `Sidebar.tsx`, but I haven't yet *run* the combination. If at Step 4 the drag fails to start, narrow the `WebkitAppRegion: no-drag` attribute as needed.
- **R3 — `WindowInfo` lacks an id; we key by name.** Two windows with the same name in one session would conflate. Today `WindowSpec.name` is required to be unique within a session at creation time. If this assumption ever breaks, the reorder behaviour for duplicate names is "treat first match as the dragged one"; persisted order would have a stable but ambiguous resolution. Track as a known limitation, not a blocker.
- **R4 — TabBar has no existing test file.** Adding the first test for it imports the component, which transitively imports xterm. We may need to mock the xterm-touching modules (e.g., `use-terminal`, `useAppStore`) in jsdom, similar to how DefaultTabsList tests mock SortableItem. Mitigation: write the tests with mocks for `window.api`, `useAppStore`, `focusTerminal`, and `SortableItem` from the start.
- **R5 — `state.service.ts` may not currently know about `workspaceService`.** Step 3 needs the persisted session to compute the visual order; injecting `workspaceService` into `StateService` may be a small constructor change. Verify at Step 3 GREEN.

## Approval

Awaiting human approval to mark `Status: approved` and proceed to `/build`.
