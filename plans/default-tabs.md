# Plan: Default Tabs (Slice B)

**Created**: 2026-04-27
**Branch**: main
**Status**: approved

## Goal

Make the per-session tab list user-editable via Settings → Default Tabs and per-workspace overrides via right-click → Edit settings. Replace the hardcoded list in `buildWindowSpecs()` for workspace-type sessions; repo sessions stay on the legacy `.gustav` path until slice C lands.

## Spec Reference

`docs/specs/default-tabs.md`. Key shapes:

```ts
type TabConfig = {
  id: string;
  name: string;
  kind: 'claude' | 'command';
  command?: string;                                  // kind: 'command' only
  args?: string;                                     // kind: 'claude' only
  appliesTo: 'standalone' | 'repository' | 'both';
};
// Preferences.defaultTabs?: TabConfig[]      (globals)
// Workspace.defaultTabs?: TabConfig[]        (per-workspace override)
```

## Acceptance Criteria

- [ ] Seeded globals on first launch are exactly Claude(both) + Git(repository) + Shell(both), in that order
- [ ] Workspace-type sessions resolve tabs via `workspace.defaultTabs ?? globals.defaultTabs`, filtered by `appliesTo === 'standalone' | 'both'`
- [ ] Repo (directory/worktree) sessions keep their existing Claude + Git + Shell + `.gustav [tmux]` shape (slice C will replace this)
- [ ] Settings sidebar has a new "Default Tabs" entry; the editor supports add/delete/reorder; rows have name/kind/command/args/appliesTo controls
- [ ] Right-click on a real workspace header (not `_standalone`) offers "Edit settings"; the modal pre-populates from `workspace.defaultTabs`; saving via `setWorkspaceDefaultTabs` works; clearing all rows removes the override
- [ ] Workspace editor never exposes `appliesTo`; saved rows always have `appliesTo: 'standalone'`
- [ ] Removing the Claude tab from globals is allowed; no error
- [ ] No new IPC channels except `SET_DEFAULT_TABS` and `SET_WORKSPACE_DEFAULT_TABS`
- [ ] All existing tests stay green; new domain/service tests cover the seed, resolution, and override-clear flows

## Steps

### Step 1: `TabConfig` type + `tabConfigToWindowSpec` helper (pure)

**Complexity**: standard
**RED**: New `src/main/domain/__tests__/tab-config.test.ts`. Cover:
- Empty list → empty WindowSpec[]
- Single claude tab + no id → `{ name, kind: 'claude' }`
- Single claude tab + id → `{ name, kind: 'claude', claudeSessionId }`
- Two claude tabs + id → only the first gets `claudeSessionId`
- Command tab with command → `{ name, kind: 'command', command }`
- Command tab with no command → `{ name, kind: 'command' }` (shell at cwd)
- Claude tab with args → `args` preserved on output
- Filter: `appliesTo: 'repository'` is filtered out when scope is `'standalone'` (and vice versa)

**GREEN**: Create `src/main/domain/tab-config.ts` exporting `TabConfig` type and `tabConfigToWindowSpec` (curried by `claudeSessionId`). Filter logic also lives here as `filterTabsByScope(list, scope: 'standalone' | 'repository')`.

**REFACTOR**: None.

**Files**: `src/main/domain/tab-config.ts`, `src/main/domain/__tests__/tab-config.test.ts`

**Commit**: `feat(domain): add TabConfig type and tab-to-window-spec helpers`

---

### Step 2: Extend `Preferences` with `defaultTabs` + seed on first read

**Complexity**: standard
**RED**: Extend `src/main/services/__tests__/preference.service.test.ts` (create the file if absent). Cover:
- First read of an empty userData seeds `defaultTabs` with three entries: Claude(both), Git(repository), Shell(both)
- A subsequent restart returns the same seed (idempotent)
- An explicit empty list (`defaultTabs: []`) is preserved — not re-seeded
- A user-edited list is preserved across restart
- Setting `defaultTabs` to a new list overwrites and persists

**GREEN**:
- In `src/main/domain/types.ts`: add `defaultTabs?: TabConfig[]` to `Preferences`.
- In `src/main/services/preference.service.ts`: on first lazy load, if `defaultTabs` field is **absent** (key missing, not empty), write the seed. Use `randomUUID()` for the IDs. The seed write goes through the existing write-queue.
- Add a method `setDefaultTabs(tabs: TabConfig[]): Promise<void>` that overwrites the list.

**REFACTOR**: Extract the seed factory `function seedDefaultTabs(): TabConfig[]` for reuse in tests.

**Files**: `src/main/domain/types.ts`, `src/main/services/preference.service.ts`, `src/main/services/__tests__/preference.service.test.ts`

**Commit**: `feat(preferences): seed and persist default tabs list`

---

### Step 3: Extend `Workspace` with `defaultTabs` + service method to set/clear

**Complexity**: standard
**RED**: Extend `src/main/services/__tests__/workspace.service.test.ts` with a new `describe('default tabs override', …)`:
- `setWorkspaceDefaultTabs(id, [tab])` writes to disk and `list()` returns it
- `setWorkspaceDefaultTabs(id, [])` is treated as "clear" — `list()` returns workspace with `defaultTabs` undefined (the field is removed from the JSON)
- `setWorkspaceDefaultTabs(id, null)` clears (same behavior as empty list)
- `setWorkspaceDefaultTabs('unknown-id', tabs)` throws

**GREEN**:
- In `src/main/domain/types.ts`: add `defaultTabs?: TabConfig[]` to `Workspace`.
- In `src/main/services/workspace.service.ts`: add
  ```ts
  async setDefaultTabs(id: string, tabs: TabConfig[] | null): Promise<void>
  ```
  that finds the workspace, sets/deletes `defaultTabs`, and persists. Empty array and `null` both delete.

**REFACTOR**: None.

**Files**: `src/main/domain/types.ts`, `src/main/services/workspace.service.ts`, `src/main/services/__tests__/workspace.service.test.ts`

**Commit**: `feat(workspace): persist per-workspace default tabs override`

---

### Step 4: Wire `buildWindowSpecs` to read from prefs/workspace overrides

**Complexity**: complex
**RED**: This is integration logic in `handlers.ts`. Strategy:
1. Extract `buildWindowSpecs` to a testable module (e.g. `src/main/ipc/build-window-specs.ts`) and unit-test it directly.
2. New tests: workspace session uses globals; workspace session uses workspace override when set; workspace override + no claude tab → no claude tab; appliesTo: 'repository' is filtered out of workspace sessions; repo sessions use the legacy path with .gustav entries; first-claude-only gets the claudeSessionId.

**GREEN**:
- Move `buildWindowSpecs` to `src/main/ipc/build-window-specs.ts` exporting a pure function:
  ```ts
  export function buildWindowSpecs(args: {
    type: SessionType;
    workspace: Workspace | null;
    preferences: Preferences;
    gustavTmuxEntries: string[];
    claudeSessionId?: string;
  }): WindowSpec[]
  ```
- For `type === 'directory' | 'worktree'`: keep current behavior (Claude + Git + Shell + .gustav extras), unchanged.
- For `type === 'workspace'`: resolve from `workspace?.defaultTabs ?? preferences.defaultTabs ?? []`, filter by `appliesTo === 'standalone' | 'both'`, map via `tabConfigToWindowSpec(claudeSessionId)`.
- Update all call sites in `handlers.ts` to pass the new args (preferences from `preferenceService.get()`, workspace from `workspaceService.findBy*`).

**REFACTOR**: Inline the legacy repo path into a private helper `legacyRepoWindowSpecs(...)` so slice C has a clean removal target.

**Files**: `src/main/ipc/build-window-specs.ts` (new), `src/main/ipc/__tests__/build-window-specs.test.ts` (new), `src/main/ipc/handlers.ts`

**Commit**: `feat(handlers): resolve workspace-session tabs from preferences and overrides`

---

### Step 5: IPC channels + preload bridge for setting tabs

**Complexity**: standard
**RED**: No direct unit tests for IPC handlers in the codebase. Verify by extension at the boundary: a new test in `preference.service.test.ts` and `workspace.service.test.ts` confirms the underlying methods work; the IPC layer is thin glue.

**GREEN**:
- `src/main/ipc/channels.ts`: add `SET_DEFAULT_TABS = 'set-default-tabs'` and `SET_WORKSPACE_DEFAULT_TABS = 'set-workspace-default-tabs'`.
- `src/main/ipc/handlers.ts`: register both handlers. Bodies validate input (must be an array of `TabConfig`-shaped objects; reject otherwise with `err`).
- `src/preload/index.ts`: expose `setDefaultTabs(tabs)` and `setWorkspaceDefaultTabs(workspaceId, tabs)` (where `tabs: TabConfig[] | null`).
- `src/preload/api.d.ts`: add typed signatures.

**REFACTOR**: None.

**Files**: `src/main/ipc/channels.ts`, `src/main/ipc/handlers.ts`, `src/preload/index.ts`, `src/preload/api.d.ts`

**Commit**: `feat(ipc): expose setDefaultTabs and setWorkspaceDefaultTabs`

---

### Step 6: `DefaultTabsList` component + Settings page

**Complexity**: complex
**RED**: New `src/renderer/components/settings/__tests__/DefaultTabsList.test.tsx` (if a renderer test setup exists; otherwise rely on visual verification via the dev server). Cover:
- Renders one row per tab; rows have name input, kind select, conditional command/args input, delete button
- `showAppliesTo={true}` shows the appliesTo select; `false` hides it
- Adding a row appends to the list; deleting removes
- Reordering via drag changes the order
- Save button calls onSave with the current list

**GREEN**:
- `src/renderer/components/settings/DefaultTabsList.tsx`: takes `{ tabs, onChange, showAppliesTo }`. Reuses the `SortableItem`/`reorderList` patterns from `WorkspaceAccordion.tsx`. Each row: name input, kind select (claude | command), command input (when kind=command) or args input (when kind=claude), appliesTo select (when showAppliesTo), drag handle, delete button. "+ Add tab" button below.
- `src/renderer/components/settings/DefaultTabsSettings.tsx`: new — loads `window.api.getPreferences()`, renders `<DefaultTabsList tabs={prefs.defaultTabs ?? []} onChange={list => debouncedSetDefaultTabs(list)} showAppliesTo />`. Uses a small debounce (e.g. 300ms) to avoid one IPC per keystroke.
- `src/renderer/components/settings/SettingsSidebar.tsx`: add "Default Tabs" nav item.
- `src/renderer/components/settings/SettingsView.tsx`: new section branch.

**REFACTOR**: If `DefaultTabsList` accumulates copy/paste from existing inputs (Tailwind classnames), extract a `<TabRow>` subcomponent.

**Files**: 4 renderer files (one new editor list, one new settings page, two existing nav components).

**Commit**: `feat(settings): Default Tabs editor in Settings sidebar`

---

### Step 7: Workspace right-click → "Edit settings" → modal

**Complexity**: complex
**RED**: Manual smoke + visual verification on the dev server. Existing context-menu pattern in `WorkspaceAccordion.tsx:237-250` is the reference.

**GREEN**:
- `src/renderer/components/sidebar/WorkspaceAccordion.tsx`: in the existing `contextMenu` JSX block (lines ~237-250), prepend an "Edit settings" button above "Delete Workspace". Show only for non-default, non-remote workspaces (mirror the existing guards on the right-click handler at lines 173-177). Wire to a new prop `onEditSettings?: () => void`.
- `src/renderer/components/workspace/WorkspaceSettingsDialog.tsx` (new): shadcn `<Dialog>`. Loads `workspace.defaultTabs ?? []`. Renders `<DefaultTabsList tabs={state} onChange={setState} showAppliesTo={false} />`. Buttons: Cancel (close), Save (call `window.api.setWorkspaceDefaultTabs(workspaceId, state.length === 0 ? null : state)`), Reset to defaults (call same channel with `null`, close). On save, force `appliesTo: 'standalone'` on every row before persisting.
- Wire `onEditSettings` from the parent (likely `App.tsx` or `Sidebar.tsx`) to open the dialog with the current workspace.

**REFACTOR**: None.

**Files**: `src/renderer/components/sidebar/WorkspaceAccordion.tsx`, `src/renderer/components/workspace/WorkspaceSettingsDialog.tsx` (new), parent component that owns the workspace right-click chain.

**Commit**: `feat(workspace): edit default tabs from right-click context menu`

---

### Step 8: Final verification

**Complexity**: trivial
**RED**: N/A — verification.
**GREEN**:
1. `npx vitest run` — all green.
2. `npx tsc --build` — no new main-process / shared-code errors (pre-existing renderer ElectronAPI errors acceptable).
3. Manual smoke on dev server:
   - Open Settings → Default Tabs → see seeded three tabs.
   - Add a new tab "Logs" with appliesTo='standalone', save.
   - Create a new workspace session → verify "Logs" tab opens and Git tab does NOT appear.
   - Create a new directory session → verify behavior unchanged (Claude + Git + Shell + .gustav).
   - Right-click a workspace → Edit settings → add a single "Notes" row → save → verify next workspace session has only "Notes".
   - Clear all rows → save → verify next workspace session falls back to globals.
**REFACTOR**: None.

**Files**: none changed.

**Commit**: none.

---

## Complexity Classification

| Step | Rating | Reasoning |
|------|--------|-----------|
| 1 | standard | Pure helpers, contained surface |
| 2 | standard | Service extension with seeding |
| 3 | standard | Service extension, persistence |
| 4 | complex | Cross-cutting refactor of `buildWindowSpecs` and its call sites |
| 5 | standard | Thin IPC + preload glue |
| 6 | complex | New component, new settings page, sidebar nav, debouncing |
| 7 | complex | Right-click wiring + new modal + parent prop chain |
| 8 | trivial | Verification |

## Pre-PR Quality Gate

- [ ] `npx vitest run` — all tests pass
- [ ] `npx tsc --build` — no new errors in main/shared
- [ ] Manual smoke: globals editor, workspace override, override clear-back-to-globals
- [ ] Manual smoke: appliesTo filtering (Git tab on repo session vs. not on workspace session)
- [ ] Slice A regression: Claude tabs from default lists still resume via `--resume <id>` after sleep/wake
- [ ] Repo sessions still use the `.gustav` path

## Risks & Open Questions

- **Risk — Seeding race on first launch**: If two simultaneous reads occur during initial app boot, both may try to seed. *Mitigation*: existing `PreferenceService` write-queue should serialize; verify in step 2 RED.
- **Risk — Renderer test framework absence**: Step 6 RED depends on whether vitest+jsdom/Testing Library is configured. *Mitigation*: if missing, fall back to manual smoke during step 6 and step 7. Don't add a renderer test framework as part of slice B.
- **Risk — Debounce on `onChange`**: Step 6 may produce IPC chatter if the user types quickly. *Mitigation*: 300ms trailing debounce on `setDefaultTabs`. Save on blur as a backstop.
- **Risk — `Workspace.defaultTabs` round-trip via `state-update`**: The renderer may render a stale workspace if the `state-update` event is throttled. *Mitigation*: `setWorkspaceDefaultTabs` returns the updated workspace via `Result<Workspace>` so the caller can update local state immediately without waiting for the broadcast.
- **Open question — Default ordering of seeded tabs**: Spec specifies Claude → Git → Shell. Confirm during step 2 that this ordering is preserved verbatim and that the IDs are stable across the session (they're stable per-row but reseeded on first read only).
- **Open question — Where does the workspace right-click chain live?**: `WorkspaceAccordion` accepts `onDeleteWorkspace` from a parent. The parent (Sidebar) needs to add `onEditSettings` and own the dialog state. Verify the prop chain during step 7; may need a quick file-find pass.
