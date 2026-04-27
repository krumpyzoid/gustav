# Drag-and-Drop Tab Reorder — Specification

## 1. Intent

Users configure default tabs at three scopes — global (Settings → Default Tabs), per-workspace (Workspace Settings dialog), and per-repository (Repo Settings dialog). Today, tabs in those forms can only be added at the bottom and removed in place. The order shown in the form is the order they open in when a session starts, but there is no way to change that order short of deleting and re-adding tabs.

This change adds drag-and-drop reordering inside the existing tab list at all three scopes, using the drag-and-drop primitive already used for the sidebar (`@atlaskit/pragmatic-drag-and-drop`). All three forms share one component (`DefaultTabsList`), so the reorder UI is implemented once.

**In scope:** mouse drag-and-drop reordering inside one mounted tab list, visible drop indicator, persistence through the existing `onChange` path (no new IPC).

**Out of scope:** keyboard reorder, touch reorder, reflow animation, bulk moves.

## 2. User-Facing Behavior

```gherkin
Feature: Reorder default tabs by drag and drop

Scenario: Reorder a tab within the global Default Tabs settings
  Given I am on Settings → Default Tabs
  And I have configured three tabs in this order: "Editor", "Logs", "Tests"
  When I drag the "Tests" row by its drag handle and drop it above "Logs"
  Then the tabs render in the order: "Editor", "Tests", "Logs"
  And after the existing 300ms save debounce, the persisted default tabs reflect that order

Scenario: Reorder a tab within Workspace Settings
  Given a workspace with default tabs "A", "B", "C"
  And the Workspace Settings dialog is open
  When I drag "C" by its drag handle and drop it above "A"
  Then the tabs render in the order "C", "A", "B"
  And the new order is staged in the dialog's dirty state
  And clicking Save persists the order via setWorkspaceDefaultTabs

Scenario: Reorder a tab within Repo Settings
  Given a repo with overridden tabs "A", "B", "C"
  And the Repo Settings dialog is open
  When I drag "A" below "C"
  Then the tabs render in the order "B", "C", "A"
  And clicking Save persists the order via setRepoConfig

Scenario: Drop indicator reflects insertion edge
  Given the tab list is rendered
  When I drag a tab and hover over the upper half of a target row
  Then a drop indicator appears on the top edge of that row
  When I move the cursor to the lower half of the same row
  Then the indicator moves to the bottom edge of the row

Scenario: Dragged row is visually distinct
  Given I have started dragging a tab row
  Then the dragged row is rendered at reduced opacity until I drop or cancel

Scenario: Editing fields is unaffected
  Given a tab list with several tabs
  When I click into the name input or any select on a row
  Then I can edit text and select options as before
  And clicking and dragging from inside an input does not initiate a row drag

Scenario: Add and Remove still work after reordering
  Given I have reordered a tab
  When I click "Add tab"
  Then a new tab is appended to the end of the list (existing behavior preserved)
  When I click the trash icon on any tab
  Then that tab is removed without affecting the order of the remaining tabs

Scenario: Reset to defaults restores order
  Given I am in Workspace Settings or Repo Settings and have reordered tabs
  When I click "Reset to defaults"
  Then the tabs are replaced with the seeded default order from the parent scope
```

## 3. Architecture

### Components touched

| File | Change |
| --- | --- |
| `src/renderer/components/sidebar/SortableItem.tsx` | Add optional `onDropEffect?: () => void` prop; replace the hard-coded `focusTerminal()` call in `onDrop` with `onDropEffect ?? focusTerminal` so existing sidebar callers keep their current behavior and the tab-list call sites can opt out |
| `src/renderer/components/settings/DefaultTabsList.tsx` | Wrap each row in `SortableItem` (with `onDropEffect={() => {}}`); add a left-side `GripVertical` handle from `lucide-react`; accept a new required `scope` prop; compute new order on drop with `reorderList` and call the existing `onChange` |
| `src/renderer/components/settings/__tests__/DefaultTabsList.test.tsx` | Add reorder coverage |
| `src/renderer/components/settings/DefaultTabsSettings.tsx` | Pass `scope="default-tabs:global"` to `DefaultTabsList` |
| `src/renderer/components/workspace/WorkspaceSettingsDialog.tsx` | Pass ``scope={`default-tabs:workspace:${workspace.id}`}`` |
| `src/renderer/components/repo/RepoSettingsDialog.tsx` | Pass ``scope={`default-tabs:repo:${repoRoot}`}`` |

### Reused primitives

- `SortableItem` (`src/renderer/components/sidebar/SortableItem.tsx:17`) — mature wrapper around `@atlaskit/pragmatic-drag-and-drop` with: drag handle ref, scope-based drop filtering, top/bottom edge detection, `opacity-40` while dragging, `border-t-2 border-t-accent` / `border-b-2 border-b-accent` drop indicators.
- `reorderList(ids, draggedId, targetId, edge)` helper from `src/renderer/components/sidebar/WorkspaceAccordion.tsx:9-16` — pure function. Either import it or inline a copy specialized to `TabConfig[]` keyed by `id`.

### Data flow

```
User drags row → SortableItem fires onReorder(draggedId, targetId, edge)
              → DefaultTabsList computes next array via reorderList on tab.id
              → calls existing onChange(nextTabs) prop
              → parent runs its existing persistence path:
                  Global  → debounced setDefaultTabs (300ms)
                  Workspace → marks dirty; persists on Save (existing)
                  Repo    → marks dirty; persists on Save (existing)
```

### What does NOT change

- `TabConfig` shape (no new field — order is implicit in array index, as today).
- IPC surface: no new channel; no change to `setDefaultTabs`, `setWorkspaceDefaultTabs`, `setRepoConfig`. Reorder is just another `onChange(nextTabs)` call.
- Persistence layer in main process.
- Tab id generation (`crypto.randomUUID()`).

### Drag-handle UX

A dedicated grip-handle column (left edge of each row) avoids collisions with the existing inputs and selects. The handle is the only draggable surface — passed to `SortableItem` via `dragHandleRef`. This matches `Sidebar` semantics. Drag-anywhere is rejected because the rows are dense with form controls; drag-from-anywhere would interfere with text selection inside `<input>` elements.

### Scope isolation

`SortableItem` already filters drops by `scope` (`SortableItem.tsx:36-37`) — this is the drag-and-drop scope (which mounted list you are dragging within), not the per-tab `appliesTo` field. Each form instance gets a unique drag scope so two simultaneously mounted lists could not cross-contaminate. In practice only one tab list is mounted at a time today, but scoping is cheap and future-proof.

### Styling

Tailwind utilities only — no new CSS file. Grip handle uses `text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing`, and `aria-label` per row for screen readers.

## 4. Acceptance Criteria

| # | Criterion | Pass condition |
| --- | --- | --- |
| AC1 | Reorder works in all three forms | Drag-and-drop in global, workspace, and repo tab lists reorders the rendered list to match the drop position |
| AC2 | Persistence in global form | After drop, within ~400ms the persisted `preferences.defaultTabs` matches the new order (300ms debounce + write) |
| AC3 | Persistence in workspace form | After drop the dirty state holds the new order; clicking Save invokes `setWorkspaceDefaultTabs(workspace.id, reorderedTabs)` once |
| AC4 | Persistence in repo form | Same as AC3 with `setRepoConfig(repoRoot, { ...config, tabs: reorderedTabs })` |
| AC5 | Drop indicator | While dragging, top/bottom drop indicator on the hovered target row tracks cursor vertical position, switching at the row midpoint |
| AC6 | Dragged-row affordance | The row being dragged renders at `opacity-40` until drop or cancel |
| AC7 | Form fields preserved | Name, kind, command/args, appliesTo, and delete continue to work on all rows after a drag interaction; clicking inside an `<input>` does not initiate a drag |
| AC8 | Add appends, remove preserves order | "Add tab" appends to the bottom (unchanged); deleting any row keeps the remaining order intact |
| AC9 | Cross-scope drops blocked | If two `DefaultTabsList` instances were mounted simultaneously with different `scope` props, a row from one cannot be dropped into the other |
| AC10 | Tests | `DefaultTabsList.test.tsx` covers: reorder produces correct array; `onChange` is called once per drop; `scope` prop is forwarded to children |
| AC11 | No new IPC channels | `git diff` shows no changes to `src/main/ipc/channels.ts`, `src/preload/index.ts`, `src/preload/api.d.ts`, or main-process services |
| AC12 | No regressions in shared sidebar drag | Existing workspace and session drag-reorder still works (sanity check — same library, no shared state) |

---

## 5. Resolved Decisions

| # | Decision | Resolution |
| --- | --- | --- |
| D1 | Drag handle | Dedicated left-side `GripVertical` handle. Drag-anywhere is rejected because rows are dense with `<input>` and `<select>` controls. |
| D2 | Keyboard reorder | Out of scope for this slice. Mirrors current Sidebar behavior. |
| D3 | Reflow animation | No animation. |
| D4 | Dirty state | Reordering counts as a change. In the workspace and repo dialogs, dropping marks the dialog dirty exactly as add/edit/remove already do, since all paths flow through the same `onChange` prop. |
| D5 | `focusTerminal()` side effect | `SortableItem` is parameterized with an optional `onDropEffect?: () => void`. Default remains `focusTerminal()` so existing Sidebar callers are unaffected. `DefaultTabsList` passes `() => {}` to opt out. |

## 6. Consistency Gate

- [x] Intent is unambiguous — two developers would interpret it the same way
- [x] Every behavior in the intent has at least one corresponding BDD scenario
- [x] Architecture constrains implementation to what the intent requires, without over-engineering
- [x] Same concepts are named consistently across all four artifacts (drag `scope` vs tab `appliesTo` are distinct and both used precisely)
- [x] No artifact contradicts another

**Verdict: PASS — ready for `/plan` or `/build`.**
