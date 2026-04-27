# Plan: Drag-and-Drop Tab Reorder

**Created**: 2026-04-27
**Branch**: main
**Status**: implemented
**Spec**: `specs/drag-and-drop-tab-reorder.md`

## Goal

Add drag-and-drop reordering to the tab configuration UI used at all three scopes (global Settings → Default Tabs, Workspace Settings dialog, Repo Settings dialog). All three forms render through the shared `DefaultTabsList` component, so the change lands in one place. We reuse the existing `@atlaskit/pragmatic-drag-and-drop`-based `SortableItem` from the sidebar, parameterizing it once to remove a hard-coded `focusTerminal()` side-effect that doesn't belong in a settings form.

## Acceptance Criteria

- [x] AC1 — Drag-and-drop reorders rows in all three forms: unit tests cover the wiring; manual verification 2026-04-27 confirmed behaviour in global, workspace, and repo forms.
- [x] AC2 — Global form persistence (300ms debounced `setDefaultTabs`): manual verification confirmed.
- [x] AC3 — Workspace dialog persistence via Save: manual verification confirmed.
- [x] AC4 — Repo dialog persistence via Save: manual verification confirmed.
- [x] AC5 / AC6 — Drop indicator and `opacity-40`: inherited from `SortableItem`; manual verification confirmed.
- [x] AC7 — Editing name/kind/command/args/appliesTo and Delete still work: existing 7 unit tests in `DefaultTabsList.test.tsx` continue to pass.
- [x] AC8 — Add appends to the end; Remove preserves order: existing unit tests cover this.
- [x] AC9 — Cross-scope drop blocking: `scope` is required and forwarded to every `SortableItem`, asserted by the `forwards the scope prop to every SortableItem` test. `SortableItem`'s `canDrop` already filters by scope.
- [x] AC11 — No new IPC channels: `git diff main~4 -- src/main/ipc src/preload src/main/services` is empty.
- [x] AC12 — Existing sidebar drag still works: 333 prior tests still pass; manual smoke confirmed.

(Spec AC10 is satisfied by Step 4 below.)

## Steps

### Step 1: Extract a reusable `reorderList` helper

**Complexity**: trivial
**RED**: Add `src/renderer/lib/__tests__/reorder-list.test.ts` covering: drop above target, drop below target, drop on first/last, dragged-id not in list (returns input), target-id not in list (returns input).
**GREEN**: Create `src/renderer/lib/reorder-list.ts` exporting `reorderList(ids: string[], draggedId: string, targetId: string, edge: 'top' | 'bottom'): string[]` — verbatim copy of the helper currently inlined at `WorkspaceAccordion.tsx:9-16`. Replace the inline definition in `WorkspaceAccordion.tsx` with an import from the new module.
**REFACTOR**: None.
**Files**: `src/renderer/lib/reorder-list.ts`, `src/renderer/lib/__tests__/reorder-list.test.ts`, `src/renderer/components/sidebar/WorkspaceAccordion.tsx`
**Commit**: `refactor: extract reorderList into shared lib`

### Step 2: Parameterize `SortableItem` with optional `onDropEffect`

**Complexity**: standard
**RED**: Add `src/renderer/components/sidebar/__tests__/SortableItem.test.tsx`. Use `vi.mock('@atlaskit/pragmatic-drag-and-drop/element/adapter', ...)` to provide stub `draggable` and `dropTargetForElements` exports that capture the config object they are called with. Also `vi.mock('../../../hooks/use-terminal', () => ({ focusTerminal: vi.fn() }))`. Tests:
1. **Default callers run `focusTerminal` on drop.** Render `<SortableItem dragType="x" itemId="a" scope="s" onReorder={vi.fn()}>row</SortableItem>`, retrieve the `onDrop` callback the stubbed `draggable` was configured with, invoke it (`captured.onDrop({})`), assert the mocked `focusTerminal` was called once and any provided `onDropEffect` was not.
2. **Custom `onDropEffect` overrides the default.** Render the same component with `onDropEffect={spy}`, invoke the captured `onDrop`, assert `spy` was called once and `focusTerminal` was not.
**GREEN**: Add an optional `onDropEffect?: () => void` prop to the `Props` type in `src/renderer/components/sidebar/SortableItem.tsx`. In the draggable's `onDrop` handler at line 31, replace `focusTerminal()` with `(onDropEffect ?? focusTerminal)()`. Default behavior unchanged for existing sidebar callers.
**REFACTOR**: None.
**Files**: `src/renderer/components/sidebar/SortableItem.tsx`, `src/renderer/components/sidebar/__tests__/SortableItem.test.tsx`
**Commit**: `refactor: allow SortableItem callers to override the on-drop side-effect`

### Step 3: Wire reorder into `DefaultTabsList`

**Complexity**: standard
**RED**: Extend `src/renderer/components/settings/__tests__/DefaultTabsList.test.tsx` with:
1. A `vi.mock('../../sidebar/SortableItem', ...)` factory that replaces `SortableItem` with a passthrough exposing its `onReorder` callback to the test (e.g., via a `data-testid` button per row).
2. A test that mounts `<ControlledList scope="test" initial={initial} spy={spy} />`, fires the mocked reorder for `(draggedId='3', targetId='1', edge='top')`, and asserts `spy` is called with `[id=3, id=1, id=2]` in that order.
3. A test asserting that every row renders an element with role/aria for the grip handle (e.g., `aria-label={`Drag handle for ${tab.name}`}`).
4. A test asserting the `scope` prop is required and forwarded — verified by spying on the mocked `SortableItem` props.
**GREEN**: In `src/renderer/components/settings/DefaultTabsList.tsx`:
- Add a required `scope: string` prop to `Props`.
- Import `SortableItem` and `reorderList`; import `GripVertical` from `lucide-react`.
- **Extract a `<TabRow>` sub-component (in the same file) that owns its own `useRef<HTMLSpanElement>(null)` for the drag handle.** This is the design choice for R1 — each row owns one ref, no map-of-refs in the parent. `<TabRow>` props: `tab`, `scope`, `onUpdate(patch)`, `onChangeKind(kind)`, `onRemove()`, `onReorder(draggedId, targetId, edge)`. Internally renders `<SortableItem dragType="default-tab" itemId={tab.id} scope={scope} dragHandleRef={handleRef} onDropEffect={() => {}} onReorder={onReorder}>...</SortableItem>` with the grip handle as the first child of the row: `<span ref={handleRef} aria-label={`Drag handle for ${tab.name}`} className="text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing"><GripVertical size={14} /></span>`.
- In the parent `DefaultTabsList`, `tabs.map` becomes `<TabRow key={tab.id} tab={tab} scope={scope} onUpdate={...} onChangeKind={...} onRemove={...} onReorder={handleReorder} />`.
- Implement `handleReorder(draggedId, targetId, edge)`: compute `nextIds = reorderList(tabs.map(t => t.id), draggedId, targetId, edge)`, then `onChange(nextIds.map(id => tabs.find(t => t.id === id)!))`.
**REFACTOR**: Confirm no logic regressions in existing edit/add/remove tests; verify `TabRow` doesn't capture stale closures over `tabs` (callbacks are passed in by parent each render, so this should be fine).
**Files**: `src/renderer/components/settings/DefaultTabsList.tsx`, `src/renderer/components/settings/__tests__/DefaultTabsList.test.tsx`
**Commit**: `feat: drag-and-drop reorder in default tabs list`

### Step 4: Pass `scope` prop from the three call sites

**Complexity**: trivial
**RED**: Extend the existing test files (or add minimal smoke tests) to assert each parent renders `DefaultTabsList` with the expected scope. If a parent has no test file, skip the test for that one and rely on TypeScript catching the missing required prop.
**GREEN**:
- `src/renderer/components/settings/DefaultTabsSettings.tsx` → `<DefaultTabsList scope="default-tabs:global" ... />`
- `src/renderer/components/workspace/WorkspaceSettingsDialog.tsx` → `<DefaultTabsList scope={`default-tabs:workspace:${workspace.id}`} ... />`
- `src/renderer/components/repo/RepoSettingsDialog.tsx` → `<DefaultTabsList scope={`default-tabs:repo:${repoRoot}`} ... />`
**REFACTOR**: None.
**Files**: the three files above (and any tests touching them)
**Commit**: `feat: scope tab-reorder drops to one form instance`

### Step 5: Manual UI verification

**Complexity**: trivial (verification only — no code)
**RED/GREEN/REFACTOR**: N/A.
**Procedure**: `npm run dev`. For each of the three forms, configure ≥3 tabs, drag rows to new positions using the grip handle, drop on top and bottom edges of various targets. Confirm:
- Drop indicator follows the cursor.
- Dragged row dims to `opacity-40`.
- Reorder persists (refresh / reopen dialog) for global (after debounce), workspace (after Save), and repo (after Save).
- Sidebar workspace and session drag still work.
- Clicking inside a `<input>` does not begin a drag; selecting text inside an input still works.
**Files**: none.
**Commit**: none — observations only. If a defect is found, return to Step 3.

## Complexity Classification

| Step | Rating | Review depth |
|------|--------|--------------|
| 1 | trivial | Skip inline review; covered by final `/code-review --changed` |
| 2 | standard | Spec-compliance + test-review (mocking pragmatic-dnd's adapter is the kind of seam that benefits from a second pair of eyes) |
| 3 | standard | Spec-compliance + relevant quality agents (svelte-review N/A; prefer js-fp-review, structure-review, test-review, a11y-review for the new `aria-label`) |
| 4 | trivial | Skip inline review |
| 5 | trivial | Manual only |

## Pre-PR Quality Gate

- [ ] All tests pass (`npm test`)
- [ ] Type check passes (`npm run typecheck` or build's tsc step)
- [ ] Linter passes (`npm run lint`)
- [ ] `/code-review --changed` passes
- [ ] Manual UI verification (Step 5) completed
- [ ] No new IPC channels introduced (`git diff` on `src/main/ipc`, `src/preload`)
- [ ] Spec consistency gate still passes (`specs/drag-and-drop-tab-reorder.md` § 6)
- [ ] Documentation: README/CLAUDE.md mention of tabs, if any, still accurate (no changes likely needed)

## Risks & Open Questions

- **~~R1 — Map-of-refs in `DefaultTabsList`.~~** *Resolved in Step 3 GREEN: extract a `<TabRow>` sub-component, each row owns its own `useRef`. No map-of-refs in the parent.*
- **~~R2 — Drag-and-drop is jsdom-untestable.~~** *Resolved in Step 2 RED: mock `@atlaskit/pragmatic-drag-and-drop/element/adapter` to capture the `onDrop` callback configured by `draggable`, then invoke it directly. Step 5 manual verification still covers real DOM-event behavior.*
- **R3 — `WorkspaceSettingsDialog` and `RepoSettingsDialog` already track dirty state through `onChange`.** Confirm that the path from reorder → `onChange` → dialog state matches the path used by edit/add/remove. Spot-checked in spec architecture; revisit if Step 4 testing surprises.
- **R4 — Grip handle alters row layout.** Adding a column may push the rightmost selects/buttons off-screen on narrow windows. The existing row already uses flex with `flex-1` / `flex-[2]` / `min-w-0`; the grip handle is small (`size={14}` + padding), so this is unlikely to regress, but check during Step 5.

## Approval

Awaiting human approval to mark `Status: approved` and proceed to `/build`.
