# Plan: Seed Settings Dialogs From Parent

**Created**: 2026-04-27
**Branch**: main
**Status**: approved

## Goal

When opening Workspace or Repo settings for a scope with no override yet, seed the editor with the parent's tab list verbatim (workspace ← globals; repo ← workspace ?? globals). Save writes the editor verbatim; an empty list is a valid explicit "zero tabs" override. Drop the per-scope `appliesTo` normalization on save (`appliesTo` becomes editable in every dialog and is preserved verbatim).

## Spec Reference

`docs/specs/seed-from-parent.md`.

## Acceptance Criteria

- [ ] Workspace dialog with no override seeds from globals; with override shows the override
- [ ] Repo dialog with no override seeds from `workspace.defaultTabs ?? globals` (workspace context comes from where the right-click happened); with override shows the override
- [ ] Both dialogs save the editor's content verbatim — no `appliesTo` force; no list-equals-parent-clears-override magic
- [ ] Both dialogs render the `appliesTo` column
- [ ] An empty tab list is a valid override (preserved as `[]`, not collapsed to `null`)
- [ ] Resolver returns `[]` for a scope whose override is `[]`; falls back to globals only when override is `undefined`
- [ ] Resolver continues to filter by `appliesTo` at session-creation time (no behavior change there)
- [ ] Workspace `defaultTabs` change does not propagate to existing repo overrides
- [ ] All tests pass; no new tsc errors in main/preload

## Steps

### Step 1: Honor empty list as explicit override (service + resolver)

**Complexity**: standard
**RED**: Update `src/main/services/__tests__/workspace.service.test.ts` and `src/main/ipc/__tests__/build-window-specs.test.ts`:
- New service test: `setDefaultTabs(id, [])` keeps `ws.defaultTabs === []` on disk; subsequent `list()` returns the workspace with `defaultTabs: []`.
- Update existing service test "treats an empty list as a clear (removes the field)" — change name and assertion: empty list is now preserved, NOT a clear. Only `null` clears.
- Update existing resolver test "treats an empty repo override tabs list as 'fall back to globals'" — change to assert empty override returns `[]` (not globals).
- Add: `buildWindowSpecs` for a workspace with `defaultTabs: []` returns `[]`.
- Keep: `buildWindowSpecs` for a workspace whose `defaultTabs` is `undefined` falls back to globals.

**GREEN**:
- `WorkspaceService.setDefaultTabs`: change `if (tabs === null || tabs.length === 0) delete …` to `if (tabs === null) delete …; else ws.defaultTabs = tabs;`.
- `build-window-specs.ts`: change `override && override.length > 0 ? override : preferences.defaultTabs ?? []` to `override !== undefined ? override : preferences.defaultTabs ?? []`.

**REFACTOR**: None.

**Files**: `src/main/services/workspace.service.ts`, `src/main/services/__tests__/workspace.service.test.ts`, `src/main/ipc/build-window-specs.ts`, `src/main/ipc/__tests__/build-window-specs.test.ts`

**Commit**: `feat(workspace,resolver): empty tab override means zero tabs, not inherit`

---

### Step 2: Drop the `showAppliesTo` prop from `DefaultTabsList`

**Complexity**: standard
**RED**: Update `src/renderer/components/settings/__tests__/DefaultTabsList.test.tsx`:
- Remove the test "hides the appliesTo column when showAppliesTo is false".
- Add: every render shows the appliesTo `<select>` for every row.
- Keep: existing tests for add/delete/rename/kind-switch (they pass `showAppliesTo` today; remove the prop from those calls).

**GREEN**:
- `DefaultTabsList.tsx`: remove `showAppliesTo` from `Props`; remove the `{showAppliesTo && …}` guard around the `<select>`.
- `DefaultTabsSettings.tsx`: drop the `showAppliesTo` prop from its `<DefaultTabsList />` usage.
- `WorkspaceSettingsDialog.tsx` (slice B): drop `showAppliesTo={false}`. **Note**: this is also where the appliesTo force lives — leave that for step 3 to keep step 2 compiler-clean.
- `RepoSettingsDialog.tsx` (slice C): drop `showAppliesTo={false}`. Same note for the force.

**REFACTOR**: None.

**Files**: `src/renderer/components/settings/DefaultTabsList.tsx`, `src/renderer/components/settings/__tests__/DefaultTabsList.test.tsx`, `src/renderer/components/settings/DefaultTabsSettings.tsx`, `src/renderer/components/workspace/WorkspaceSettingsDialog.tsx`, `src/renderer/components/repo/RepoSettingsDialog.tsx`

**Commit**: `refactor(settings): always show appliesTo column; remove showAppliesTo prop`

---

### Step 3: Workspace dialog — seed from globals; save verbatim

**Complexity**: standard
**RED**: Add a new test file `src/renderer/components/workspace/__tests__/WorkspaceSettingsDialog.test.tsx` (mirror the RTL pattern from `RepoSettingsDialog.test.tsx`):
- With `workspace.defaultTabs === undefined`: opens, renders globals verbatim (3 rows including Git with appliesTo='repository').
- With `workspace.defaultTabs = [Notes]`: opens, renders [Notes] only.
- Save without changes from a seeded state: calls `setWorkspaceDefaultTabs(id, [seeded list verbatim])`.
- Save after deleting a row: payload reflects the deletion verbatim.
- Save with appliesTo edited per row: payload preserves each row's appliesTo (no normalization).
- Reset: calls `setWorkspaceDefaultTabs(id, null)`.

**GREEN**:
- `WorkspaceSettingsDialog.tsx`: add `useEffect` that, when `open && workspace.defaultTabs === undefined`, calls `window.api.getPreferences()` and seeds `tabs` from `prefs.defaultTabs ?? []`.
- Drop the `tabs.map(t => ({ ...t, appliesTo: 'standalone' }))` normalization in `handleSave`. Save the editor list as-is.
- Drop the `payload = normalized.length === 0 ? null : normalized` collapse — empty list saves as `[]` now (already covered by step 1, but the dialog must pass `[]` not `null`).

**REFACTOR**: None.

**Files**: `src/renderer/components/workspace/WorkspaceSettingsDialog.tsx`, `src/renderer/components/workspace/__tests__/WorkspaceSettingsDialog.test.tsx` (new)

**Commit**: `feat(workspace): seed workspace settings from globals; save verbatim`

---

### Step 4: Repo dialog — accept `workspaceId` prop, seed from workspace ?? globals; save verbatim

**Complexity**: complex
**RED**: Update `src/renderer/components/repo/__tests__/RepoSettingsDialog.test.tsx`:
- Inject a mock `useAppStore` (or stub `globalThis.window.api.getState` if the dialog reads via state). The simplest is to add a `workspaces` parameter to the test render helper that pre-seeds the store.
- Add: dialog with `workspaceId='ws1'` and that workspace has `defaultTabs=[Claude, Notes]`, no repo override → tabs section seeds with [Claude, Notes].
- Add: dialog with `workspaceId='ws1'` and that workspace has no override → tabs section seeds with globals.
- Add: dialog with `workspaceId={null}` and globals exist → seeds from globals.
- Update existing "saves the config with appliesTo forced to 'repository'" test → rename to "saves config with appliesTo verbatim per row" and assert the payload preserves the editor's appliesTo.

**GREEN**:
- `RepoSettingsDialog.tsx`: add `workspaceId?: string | null` prop. On open with no override, look up workspace via the renderer's app-state hook (or `useAppStore.getState()`); pick `workspace.defaultTabs ?? prefs.defaultTabs ?? []` as the seed.
- Drop the `tabs.map(t => ({ ...t, appliesTo: 'repository' }))` normalization in `handleSave`. Save tabs verbatim.

**REFACTOR**: Extract the seed logic into a small helper `selectParentTabs(workspace, prefs)` if it makes the effect easier to read.

**Files**: `src/renderer/components/repo/RepoSettingsDialog.tsx`, `src/renderer/components/repo/__tests__/RepoSettingsDialog.test.tsx`

**Commit**: `feat(repo): seed repo settings from workspace or globals; save verbatim`

---

### Step 5: Wire `workspaceId` from `RepoGroup` → `Sidebar` → `App`

**Complexity**: standard
**RED**: Manual smoke. The existing component layers don't have automated tests for the prop chain.

**GREEN**:
- `WorkspaceAccordion.tsx` `RepoGroupProps`: change `onEditRepoSettings?: (repoRoot, repoName) => void` to `onEditRepoSettings?: (repoRoot, repoName, workspaceId: string | null) => void`. Update the click handler to pass `workspaceId` (the prop already exists on `RepoGroup`).
- `WorkspaceAccordion.tsx` `Props.onEditRepoSettings`: same signature change.
- `Sidebar.tsx` `Props.onEditRepoSettings`: same. The handler is passed through to `WorkspaceAccordion`.
- `App.tsx`: change `repoSettings` state to `{ repoRoot, repoName, workspaceId: string | null } | null`. Update `onEditRepoSettings` to accept the third arg and store it. Pass `workspaceId={repoSettings.workspaceId}` to `<RepoSettingsDialog />`.
- The default ("Standalone") accordion has no workspace, so its `RepoGroup` (if any repo there) passes `null`. In our model the default workspace doesn't pin repos directly, so this is mostly defensive — keep the `null` branch.

**REFACTOR**: None.

**Files**: `src/renderer/components/sidebar/WorkspaceAccordion.tsx`, `src/renderer/components/sidebar/Sidebar.tsx`, `src/renderer/App.tsx`

**Commit**: `feat(repo): pass workspaceId from sidebar through to RepoSettingsDialog`

---

### Step 6: Final verification

**Complexity**: trivial
**RED**: N/A.
**GREEN**:
1. `npx vitest run` — all green.
2. `npx tsc --build` — no new main/preload errors.
3. Manual smoke (when you next test):
   - Open Workspace settings on a fresh workspace → see seeded globals; remove a row; Save → next workspace session reflects the smaller list.
   - Open Repo settings on a repo in a workspace whose override is set → see workspace's tabs; Save without changes; verify the repo override now matches.
   - Edit globals; verify already-saved workspace and repo overrides are unaffected.
   - Save an empty list at any scope → next session in that scope opens with no tabs.

**REFACTOR**: None.

**Files**: none.

**Commit**: none.

---

## Complexity Classification

| Step | Rating | Reasoning |
|------|--------|-----------|
| 1 | standard | Service + resolver semantic change; covered by unit tests |
| 2 | standard | Component prop removal across three callers |
| 3 | standard | Single-component logic + new test file |
| 4 | complex | Cross-file (dialog + store read); appliesTo normalization removal; new prop |
| 5 | standard | Prop-chain wiring |
| 6 | trivial | Verification |

## Pre-PR Quality Gate

- [ ] `npx vitest run` green
- [ ] `npx tsc --build` clean (main/preload)
- [ ] Manual smoke: workspace seed + save + global change isolation
- [ ] Manual smoke: repo seed (workspace and globals branches)
- [ ] Manual smoke: empty list = zero tabs at next session
- [ ] No new appliesTo filtering in dialogs (resolver still filters)

## Risks & Open Questions

- **Risk — RTL test for store read**: Step 4's seeding from workspace requires reading from the renderer's `useAppStore`. Tests need to either inject the store state or mock the store hook. *Mitigation*: use the existing `useAppStore.setState({ workspaces: [...] })` pattern from the store itself; render after seeding; the dialog's `useEffect` runs and reads the seeded state. If `useAppStore` is hard to seed in jsdom, fall back to passing the workspace via prop instead — minor signature tweak.
- **Risk — Existing repo overrides may have all rows normalized to `appliesTo: 'repository'`**: Today's saved repo configs went through the slice C force. After step 4, those rows still have `'repository'`, which is correct (no migration needed). New rows the user adds will use whatever they pick. *No mitigation needed*.
- **Risk — Workspace overrides persisted under slice B may all have `'standalone'`**: Same shape, same outcome — the new dialog shows them with their stored appliesTo, user can edit. *No mitigation needed*.
- **Open question — Default `appliesTo` for newly-added rows in workspace/repo dialogs**: The "Add tab" button creates `{ ..., appliesTo: 'both' }` (current default in `DefaultTabsList`). That stays — the user can adjust per row. Confirm OK.
