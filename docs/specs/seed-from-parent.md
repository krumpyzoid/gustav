# Spec: Settings Dialogs Seed From Parent

## 1. Intent Description

When opening **Workspace settings** or **Repository settings** for a scope with no override yet, the editor is seeded with the **parent's tab list, unfiltered**. Save writes the editor's content verbatim as the override; Reset clears the override. Workspace's parent is **globals**; repo's parent is **the originating workspace's override if set, else globals**. Once a snapshot is captured, parent changes do not propagate.

This makes the inheritance an explicit one-way clone: edit-from-where-you-came-from. Each scope owns its own list afterward.

`appliesTo` stays as a per-row field, editable in every dialog. The resolver still filters by it at session-creation time, so a `Git`-tagged-`repository` row in a workspace override simply never appears in workspace sessions — same gate as today.

## 2. User-Facing Behavior (Gherkin)

```gherkin
Feature: Settings dialogs seed from the parent scope

  Scenario: Fresh workspace dialog seeds from globals (no filter)
    Given workspace "Acme" has no defaultTabs override
    And global default tabs are [Claude(both), Git(repository), Shell(both)]
    When the user opens Edit settings for "Acme"
    Then the editor shows all three rows verbatim, including Git with appliesTo='repository'
    And the appliesTo column is visible and editable per row

  Scenario: Workspace dialog with override shows the override
    Given workspace "Acme" has a defaultTabs override [Notes(standalone)]
    When the user opens Edit settings
    Then the editor shows [Notes(standalone)] verbatim

  Scenario: Save writes whatever is in the editor as the override
    Given the dialog is seeded from globals (Claude, Git, Shell)
    When the user removes Git and clicks Save
    Then setWorkspaceDefaultTabs is called with [Claude, Shell] verbatim
    And the workspace's override now equals [Claude, Shell]

  Scenario: Save without edits stores the seed as the override
    Given the dialog is seeded from globals
    When the user clicks Save without changes
    Then setWorkspaceDefaultTabs is called with the full seeded list
    And subsequent global changes do not affect this workspace

  Scenario: Reset clears the override
    When the user clicks "Reset to defaults"
    Then setWorkspaceDefaultTabs is called with null
    And the next time the dialog opens, it re-seeds from current globals

  Scenario: Repo dialog seeds from the originating workspace's override when present
    Given workspace "Acme" has defaultTabs [Claude, Notes]
    And a repo "api" pinned in "Acme" has no override
    When the user right-clicks "api" in "Acme" and opens Edit settings
    Then the Tabs section seeds with [Claude, Notes]
    And env / postCreateCommand / baseBranch are empty

  Scenario: Repo dialog falls back to globals when the workspace has no override
    Given workspace "Acme" has no defaultTabs override
    And global default tabs are [Claude, Git, Shell]
    And a repo "api" pinned in "Acme" has no override
    When the user opens Edit settings for "api"
    Then the Tabs section seeds with [Claude, Git, Shell]

  Scenario: Repo dialog opened with no workspace context seeds from globals
    Given the user opens Edit settings for a repo not pinned in any workspace
    When the dialog opens
    Then the Tabs section seeds from globals

  Scenario: Workspace config change does not propagate to existing repo overrides
    Given a repo "api" was previously seeded from workspace "Acme" and saved
    When the user changes "Acme"'s defaultTabs
    Then "api"'s override is unchanged
    And the next session for "api" still uses "api"'s override

  Scenario: Empty list is a valid explicit override (zero tabs)
    Given the dialog editor has zero rows
    When the user clicks Save
    Then the override is stored as an empty array (not null)
    And the next session for that scope opens with no tabs

  Scenario: Resolver still filters by appliesTo
    Given workspace "Acme" override contains a row with appliesTo='repository'
    When a workspace-type session is created in "Acme"
    Then that row does not appear in the session
    And rows with appliesTo='standalone' or 'both' do appear
```

## 3. Architecture Specification

### Renderer wiring

- `RepoGroup` (`WorkspaceAccordion.tsx`) `onEditRepoSettings` callback gains a `workspaceId: string | null` argument. The default ("Standalone") accordion passes `null`.
- `App.tsx` `repoSettings` state expands to `{ repoRoot, repoName, workspaceId: string | null }`.
- `RepoSettingsDialog` accepts a new optional `workspaceId: string | null` prop. On open, in addition to `getRepoConfig` and `getBranches`, it reads the workspace from the renderer's `useAppStore` (already broadcasts `defaultTabs` via `state-update`). No new IPC channel needed.

### Seeding logic (both dialogs)

Workspace dialog:
```ts
if (workspace.defaultTabs !== undefined) {
  setTabs(workspace.defaultTabs);
} else {
  const prefs = await window.api.getPreferences();
  setTabs(prefs.defaultTabs ?? []);   // verbatim, no appliesTo filter
}
```

Repo dialog:
```ts
const override = await window.api.getRepoConfig(repoRoot);
if (override?.tabs !== undefined) {
  setTabs(override.tabs);
} else {
  const ws = workspaceId
    ? useAppStore.getState().workspaces.find(w => w.workspace?.id === workspaceId)?.workspace
    : null;
  const parentTabs = ws?.defaultTabs ?? prefs.defaultTabs ?? [];
  setTabs(parentTabs);   // verbatim
}
```

Both dialogs always render `appliesTo` in `DefaultTabsList` (the `showAppliesTo` prop is removed).

### Save logic

- Workspace dialog: `setWorkspaceDefaultTabs(workspaceId, tabs)` verbatim. Drop the `tabs.map(t => ({ ...t, appliesTo: 'standalone' }))` normalization from slice B.
- Repo dialog: build the candidate `RepoConfig` from editor state. Save via `setRepoConfig(repoRoot, candidate)` verbatim. Drop the `tabs.map(t => ({ ...t, appliesTo: 'repository' }))` normalization from slice C.

### Service: empty list is a valid override

`WorkspaceService.setDefaultTabs(id, tabs | null)`:
- `null` → delete field (existing).
- `[]` → preserve the empty array (changed from current behavior, which deletes).
- non-empty → replace (existing).

### Resolver: empty override is honored

`buildWindowSpecs`:
```ts
const override = isRepoSession ? args.repoConfig?.tabs : args.workspace?.defaultTabs;
const list = override !== undefined ? override : args.preferences.defaultTabs ?? [];
```

`override !== undefined` honors `[]` as zero tabs; `undefined` (field absent) keeps falling back to globals.

### Component cleanup

- `DefaultTabsList`: remove the `showAppliesTo` prop; always render the appliesTo column. Update tests.
- `WorkspaceSettingsDialog`, `RepoSettingsDialog`: drop the appliesTo-force normalization on save and the `showAppliesTo={false}` prop.

### Out of scope

- Visual marker / banner indicating "this is a fresh seed".
- Per-field inheritance markers in the repo dialog.
- Resolver chain change so repo sessions transitively pick up workspace tabs without a repo override.
- Removing `appliesTo` entirely.

## 4. Acceptance Criteria

| # | Criterion | Verification |
|---|---|---|
| 1 | Workspace dialog with no override seeds the editor with the full globals list (no appliesTo filter). | Component test. |
| 2 | Workspace dialog with an override shows the override unchanged. | Component test. |
| 3 | Workspace save calls `setWorkspaceDefaultTabs(id, tabs)` verbatim — no appliesTo normalization. | Component test. |
| 4 | Repo dialog with originating workspaceId seeds Tabs from `workspace.defaultTabs ?? globals`. | Component test (both branches). |
| 5 | Repo dialog with no workspace context seeds Tabs from globals. | Component test. |
| 6 | Repo save calls `setRepoConfig(repoRoot, config)` with tabs verbatim. | Component test. |
| 7 | An empty tab list is a valid override; `WorkspaceService.setDefaultTabs(id, [])` preserves the field. | Service unit test. |
| 8 | `buildWindowSpecs` returns an empty list for a session whose scope override is `[]`. | Resolver unit test. |
| 9 | `buildWindowSpecs` falls back to globals when the override is `undefined`. | Existing test still passes. |
| 10 | Workspace dialog shows `appliesTo` column; saved rows preserve their appliesTo. | Component test. |
| 11 | Repo dialog shows `appliesTo` column; saved rows preserve their appliesTo. | Component test. |
| 12 | Resolver continues to filter by appliesTo at session-creation time. | Existing tests stay green. |
| 13 | Workspace's `defaultTabs` change does not mutate any pre-existing repo overrides. | Unit test on the service layer. |

## 5. Consistency Gate

- [x] Intent unambiguous (snapshot semantics, seed verbatim, parent chain spec'd).
- [x] Every behavior in the intent has a Gherkin scenario.
- [x] Architecture changes only what the intent requires.
- [x] Names consistent with prior slices.
- [x] No artifact contradicts another.

**Gate: PASS.** Implementation plan: `plans/seed-from-parent.md`.
