# Window Tab Reorder + Focus on Create — Specification

## 1. Intent

The active-session tab bar (`TabBar.tsx`) shows one button per tmux window in the current session. Two related improvements:

1. **Drag to reorder window tabs.** Users can already reorder *configured* default tabs (recently shipped). They cannot reorder the live tabs of the active session. Add drag-and-drop reordering to `TabBar`. **The new order is a Gustav-side display concern only — tmux windows are not moved and their indices stay the same.** The reordered display is persisted with the session so it survives switching sessions, restarting Gustav, or reattaching.

   The two natural objections to a Gustav-only ordering are both already moot in this app:
   - *"Won't tmux's `prefix-N` keybinding select the wrong window?"* — Gustav blocks tmux's `prefix-N` shortcuts at the input layer, so the visual-order vs tmux-index mismatch is invisible to the user.
   - *"Won't a user attaching outside Gustav see a different order?"* — attaching outside Gustav is explicitly discouraged. We do not optimize for that path.

2. **Focus the terminal after creating a new window tab.** Today, after typing a tab name and pressing Enter, the input unmounts and focus lands on `<body>`. The new tmux window is active but the user has to click into the terminal before they can type. This change calls `focusTerminal()` after `window.api.newWindow(...)` resolves so the user can keep typing.

**In scope:** mouse drag-and-drop reorder of the window-tab strip; persistence of the new order in Gustav's per-session record; auto-focus the terminal after `newWindow` resolves; auto-focus the terminal after a successful drop.

**Out of scope:** keyboard reorder, animated reflow, refocusing the terminal after `selectWindow` (clicking an existing tab — already correct via the existing `preventDefault` on tab `mousedown`) or `killWindow`, syncing the visual order to tmux itself, syncing across multiple connected tmux clients, dragging tabs between sessions.

## 2. User-Facing Behavior

### A. Reorder window tabs

```gherkin
Scenario: Reorder a window tab to the left
  Given I have an active session with windows "Editor", "Logs", "Tests" in that visual order
  When I drag the "Tests" tab and drop it on the left edge of "Logs"
  Then the tab strip renders the order: "Editor", "Tests", "Logs"
  And after switching to another session and back, the order is still "Editor", "Tests", "Logs"

Scenario: Reorder survives a Gustav restart
  Given I have reordered the windows of a session
  When I close and reopen Gustav and reattach the session
  Then the tab strip shows my saved order, not tmux's native window-index order

Scenario: Reorder does not move tmux windows
  Given the tab strip displays "Editor", "Logs", "Tests" before my reorder
  And tmux list-windows reports them at indices 0, 1, 2 respectively
  When I drag "Tests" to the left of "Logs"
  Then tmux list-windows still reports them at the same indices 0, 1, 2
  And the tmux prefix-1 keybinding still selects "Logs", not "Tests"

Scenario: Reorder does not change which tab is active
  Given "Logs" is the active window
  When I drag "Editor" past "Tests"
  Then "Logs" remains the active window
  And the terminal continues showing the "Logs" pane

Scenario: Click still switches tabs
  Given a tab strip with three tabs
  When I click (without dragging) any tab
  Then the click selects that window via window.api.selectWindow
  And focus stays in the terminal (existing behavior, preserved)

Scenario: Drop indicator
  Given I am dragging a tab
  Then I see a left-edge or right-edge indicator on the hovered target tab
  Indicating the side the dragged tab will land on

Scenario: Drop returns focus to the terminal
  Given I have just dropped a tab in a new position
  Then the terminal is the focused element
  And keystrokes I type next reach the active tmux window's pane

Scenario: New window appears at the end of the visual order
  Given my saved visual order is "Tests", "Editor", "Logs"
  When I create a new window named "Notes"
  Then the tab strip renders: "Tests", "Editor", "Logs", "Notes"

Scenario: Closing a window leaves the order intact
  Given my visual order is "Tests", "Editor", "Logs"
  When I close "Editor"
  Then the tab strip renders: "Tests", "Logs"
  And the saved order omits "Editor"

Scenario: Externally-created windows append to the visual order
  Given Gustav is showing a saved order "Tests", "Editor", "Logs"
  And a new window is created in tmux from outside Gustav (e.g., by the user via tmux's prefix-c)
  When Gustav next reconciles its window list
  Then the new window appears at the end of the visual order
```

### B. Focus terminal after creating a new window tab

```gherkin
Scenario: Typing into a new tab works without clicking the terminal
  Given I click "+" on the tab bar
  And I type "Logs" and press Enter
  When window.api.newWindow resolves
  Then the terminal is focused
  And keystrokes I type next reach the new tmux window's pane

Scenario: Focus is not stolen when handleAdd early-returns
  Given the input value is empty or only whitespace (handleAdd early returns)
  When I press Enter
  Then no IPC call is made
  And focus is not forced to the terminal
```

## 3. Architecture

### A. Window tab reorder (Gustav-side only)

| File | Change |
| --- | --- |
| `src/renderer/components/terminal/TabBar.tsx` | Wrap each tab `<button>` in `SortableItem` (drag-from-anywhere on the tab body, no separate handle). Use `dragType="window-tab"` and `scope={`window-tabs:${activeSession}`}`. Pass `onDropEffect={focusTerminal}` so dropping returns focus to the terminal. On reorder, compute the new ordered list with `reorderList` and call `window.api.setWindowOrder(activeSession, newOrderNames)`. Optimistically update the local `windows` state. |
| `src/preload/index.ts`, `src/preload/api.d.ts` | Add `setWindowOrder(session: string, names: string[]): Promise<Result<void>>`. |
| `src/main/ipc/channels.ts` | Add `SET_WINDOW_ORDER: 'set-window-order'`. |
| `src/main/ipc/handlers.ts` | Add a handler that validates the input shape and writes the order through the workspace/session service. |
| `src/main/services/workspace.service.ts` (or session service — exact location is a /plan decision) | Add a `setWindowOrder(session, names)` method that updates the `PersistedSession.windows` array order in place (reorder the existing `WindowSpec[]` to match `names`, leaving each spec's other fields untouched). Persist via the existing snapshot path. |
| Window list reconciliation | When the renderer receives a fresh `windows: WindowInfo[]` payload from tmux, sort it by the saved order before calling `setWindows`. Windows present in tmux but not in the saved order are appended. Windows in the saved order but not in tmux are dropped from the order on the next persist. The reconciliation lives wherever `setWindows` is fed — likely `use-app-state.ts` or a small helper called by the same. |
| `src/renderer/lib/reorder-list.ts` | Reuse — already extracted in the previous slice. |
| `src/renderer/components/sidebar/SortableItem.tsx` | Reuse — already supports `onDropEffect`. |

### Why key the order by window name, not tmux index?

`PersistedSession.windows` is already a `WindowSpec[]` keyed implicitly by `name`. Reordering that array matches the existing persistence model. Indices, in contrast, are tmux-internal and survive only as long as the session does — they don't make sense for cross-restart persistence. Duplicate names within a session are not a current concern (default tabs enforce per-session uniqueness in practice), and if they ever become one, the duplicate's reorder behavior is just "same as for the first match" — no data corruption.

### Reorder data flow

```
User drags tab A past tab B
  → SortableItem fires onReorder(draggedName, targetName, edge)
  → TabBar:
      newOrderNames = reorderList(currentNames, draggedName, targetName, edge)
      Optimistic setWindows(...windows reordered by newOrderNames)
  → window.api.setWindowOrder(activeSession, newOrderNames)
    → main process workspaceService.setWindowOrder(session, names)
      → reorder PersistedSession.windows by name match
      → persist
  → onDropEffect={focusTerminal} returns focus to xterm
```

### Drag-anywhere on the tab body

Tabs are short and dense; a grip handle would clutter. `pragmatic-drag-and-drop` distinguishes click from drag using a movement threshold, so click-to-switch continues to work. The same pattern is in use in the sidebar (`Sidebar.tsx` uses `WebkitAppRegion: drag` on the parent and `WebkitAppRegion: no-drag` on tabs/buttons alongside DnD reorder), so we know the Electron drag-region attributes don't conflict with `pragmatic-drag-and-drop`.

### Tmux is untouched

This change does **not** call `move-window`, `swap-window`, or any other tmux mutation. tmux remains the canonical source of truth for which windows exist; Gustav owns only their visual presentation order in its UI.

### B. Focus on new tab

| File | Change |
| --- | --- |
| `src/renderer/components/terminal/TabBar.tsx` | In `handleAdd`, after `await window.api.newWindow(...)` resolves, call `focusTerminal()` (imported from `../../hooks/use-terminal`). |

That's the entire change for B.

### What does NOT change

- `WindowInfo` shape.
- `WindowSpec` shape.
- `selectWindow` / `killWindow` IPC handlers and their renderer call sites.
- Any other tab UIs (sidebar workspace tabs, default-tabs settings).
- tmux behavior in any way.

## 4. Acceptance Criteria

| # | Criterion | Pass condition |
| --- | --- | --- |
| AC1 | Drag-reorder works across all positions | Drag any tab to any other tab on the left or right edge; tab strip renders the new order |
| AC2 | Order persists across session re-attach in Gustav | Reorder, switch to another session and back: new order is shown |
| AC3 | Order persists across Gustav restart | Reorder, restart Gustav, reattach session: new order is shown |
| AC4 | Tmux untouched | After reorder, `tmux list-windows -t <session>` reports the same indices and order as before |
| AC5 | Active window unchanged | The window that was active before reorder is still active after |
| AC6 | Click still switches tabs | A click without horizontal drag movement above the library's threshold continues to call `selectWindow`; focus stays in the terminal |
| AC7 | Drop indicator visible | While dragging, an edge indicator (left or right) renders on the hovered target tab corresponding to the cursor's horizontal half |
| AC8 | Drop returns focus to terminal | After dropping a tab, the xterm terminal is the focused element |
| AC9 | Focus on new tab | After `handleAdd` resolves successfully, the terminal is the focused element |
| AC10 | Focus not stolen on early return | `handleAdd` early-returns for empty/whitespace input without calling `focusTerminal` |
| AC11 | New windows append to the visual order | A window created after a reorder lands at the end of the visual order |
| AC12 | Closed windows are dropped from the order | Closing a window removes it from the saved order; remaining order is preserved |
| AC13 | Externally-created windows append on reconcile | A tmux window created outside Gustav appears at the end of the visual order on the next reconcile |
| AC14 | Tests | New tests cover: reconciliation logic (saved order + fresh tmux list → final order); `TabBar` calls `setWindowOrder` IPC with the correct name list; `TabBar.handleAdd` calls `focusTerminal` on success and not on early return |
| AC15 | No regressions | All existing TabBar behaviors (add, kill, click-switch, sleep on last close) continue to work |

## 5. Resolved Decisions

| # | Decision | Resolution |
| --- | --- | --- |
| D1 | Bundle vs split | Bundle into one spec/plan. Implement as **two separate commits**: one for the reorder feature, one for the focus-on-new-tab fix. |
| D2 | Drag handle vs drag-anywhere | Drag-anywhere on the tab body. Tabs are too small to host a grip handle; the click-vs-drag movement threshold preserves click-to-switch. |
| D3 | Electron drag-region collision | Non-issue. The sidebar already combines `WebkitAppRegion: drag/no-drag` with `pragmatic-drag-and-drop` reorder and works. Same pattern applies here. |
| D4 | Refocus terminal after drop | Yes — matches the existing intent that "after touching the tab bar, return to typing." Wired via `onDropEffect={focusTerminal}` on `SortableItem`. |
| D5 | Persist where? | Gustav-side only. tmux is untouched. The order rides on `PersistedSession.windows`'s array order (or an equivalent per-session field — exact location is a `/plan` detail). The two usual objections to Gustav-only ordering (`prefix-N` mismatch, external-attach mismatch) are moot: Gustav blocks `prefix-N`, and external attaches are discouraged. |
| D6 | Click-to-switch focus | Already correct. `onMouseDown(e) => e.preventDefault()` on tabs prevents the focus-steal that a normal `<button>` mousedown would cause, so the terminal keeps focus across `selectWindow`. No change needed. |

## 6. Consistency Gate

- [x] Intent is unambiguous — two developers would interpret it the same way
- [x] Every behavior in the intent has at least one corresponding BDD scenario
- [x] Architecture constrains implementation to what the intent requires, without over-engineering
- [x] Same concepts are named consistently (`window`, `tab`, `name`, `visual order`)
- [x] No artifact contradicts another

**Verdict: PASS — ready for `/plan`.**
