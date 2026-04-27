# Spec: Default Tabs (Slice B)

## 1. Intent Description

Replace the hardcoded tab list in `buildWindowSpecs()` (`src/main/ipc/handlers.ts:29-50`) with a user-editable list reachable from a new "Default Tabs" section under Settings. Two scopes:

- **Global defaults** — fallback for every session (workspace and repo). Stored in `preferences.json`.
- **Per-workspace override** — replaces globals for that workspace's workspace-type sessions only. Stored on `Workspace.defaultTabs` in `workspaces.json`. Reachable from a right-click on a workspace header → "Edit settings" → Default Tabs modal.

Repo (directory/worktree) sessions are out of scope for this slice — they continue to read `.gustav [tmux]` until slice C lands.

Each tab carries an `appliesTo` field (`'standalone' | 'repository' | 'both'`) so a single global list can serve both session contexts:
- `'standalone'` — only workspace-type sessions (in real workspaces or `_standalone`).
- `'repository'` — only repo-type sessions (directory + worktree).
- `'both'` — all sessions.

This lets users keep one global list and have e.g. a "Git/lazygit" tab show up only on repo sessions.

## 2. User-Facing Behavior (Gherkin)

```gherkin
Feature: Configurable default tabs

  Scenario: Settings panel exposes a Default Tabs section
    Given the user opens Settings
    Then the sidebar lists "Appearance", "Default Tabs", "Remote"
    When the user clicks "Default Tabs"
    Then a reorderable list of tabs is shown
    And each row has fields: name, kind (claude | command), command (or args), appliesTo (standalone | repository | both)

  Scenario: A user with no prior config sees the seeded defaults
    Given a fresh installation
    When the user opens Default Tabs for the first time
    Then three tabs are listed in this order:
      | name        | kind    | command   | appliesTo  |
      | Claude Code | claude  |           | both       |
      | Git         | command | lazygit   | repository |
      | Shell       | command |           | both       |

  Scenario: Editing global tabs affects new workspace sessions
    Given the global default tabs list
    When the user adds a tab "Logs" of kind "command" with command "tail -f log/dev.log" and appliesTo "standalone"
    And creates a new workspace-type session
    Then the new session opens with one tab "Logs" running tail -f log/dev.log

  Scenario: appliesTo filters which sessions receive a tab
    Given the global default tabs include "Git" with appliesTo "repository"
    When a workspace-type session is created
    Then the session does NOT include a "Git" tab

  Scenario: Existing sessions are not retroactively edited
    Given a workspace session is already running with the old tab list
    When the user changes the global default tabs
    Then the running session is unchanged
    And only sessions created after the edit reflect the new tabs

  Scenario: Right-click on a workspace header offers Edit settings
    Given the user right-clicks on a workspace header
    Then a context menu appears with "Edit settings" and "Delete Workspace"

  Scenario: Workspace override modal pre-populates from override or is empty
    Given a workspace "Acme" with no defaultTabs override
    When the user opens Edit settings for "Acme"
    Then the Default Tabs editor shows zero rows
    And a label clarifies that globals are in effect

    Given a workspace "Acme" with a defaultTabs override of one row
    When the user opens Edit settings for "Acme"
    Then the editor shows that one row

  Scenario: Workspace override fully replaces globals for that workspace's workspace sessions
    Given workspace "Acme" has a defaultTabs override of one tab "Notes" of kind "command" with no command and appliesTo "standalone"
    When a workspace-type session is created in "Acme"
    Then the session opens with one tab "Notes" (an empty shell at cwd)
    And no other tabs from globals are added

  Scenario: Clearing all rows in workspace settings removes the override
    Given workspace "Acme" has a defaultTabs override
    When the user clears all rows and saves
    Then Acme.defaultTabs is removed (not stored as an empty array)
    And subsequent workspace-type sessions in "Acme" use the global defaults

  Scenario: appliesTo is hidden in the workspace override editor
    Given the user opens Edit settings for any workspace
    Then the Default Tabs editor does NOT show an appliesTo selector
    And new rows are saved with appliesTo = "standalone"

  Scenario: Repo sessions are unchanged in slice B
    Given the user has a .gustav file with [tmux] entries in a repo
    When the user creates a directory or worktree session for that repo
    Then the session opens with Claude Code + Git + Shell + the .gustav tabs (existing behavior)
    And the global default tabs are NOT used for repo sessions in this slice

  Scenario: Removing the Claude tab is allowed
    Given the user removes the Claude tab from globals and saves
    When a new workspace-type session is created
    Then the session has no Claude tab and no error is logged

  Scenario: Slice A composition — Claude tabs in defaults still resume correctly
    Given the global defaults include the seeded "Claude Code" tab
    And a workspace session was sleeping with claudeSessionId "abc"
    When the user wakes the session
    Then the Claude tab restarts with "claude --resume abc"
```

## 3. Architecture Specification

### Domain types

```ts
// src/main/domain/tab-config.ts (new)
export type TabConfig = {
  id: string;
  name: string;
  kind: 'claude' | 'command';
  command?: string;                                  // kind: 'command' only
  args?: string;                                      // kind: 'claude' only
  appliesTo: 'standalone' | 'repository' | 'both';
};
```

`Preferences` (`types.ts`) gains:
```ts
defaultTabs?: TabConfig[];
```

`Workspace` (`types.ts`) gains:
```ts
defaultTabs?: TabConfig[];   // override; absent = inherit globals
```

### Seeding

On first read of `preferences.json`, if `defaultTabs` is missing, seed:
```ts
[
  { id: <uuid>, name: 'Claude Code', kind: 'claude',  appliesTo: 'both' },
  { id: <uuid>, name: 'Git',         kind: 'command', command: 'lazygit', appliesTo: 'repository' },
  { id: <uuid>, name: 'Shell',       kind: 'command', appliesTo: 'both' },
]
```

The seed write is best-effort; failure does not block the app.

### Resolution

New helper `tabConfigToWindowSpec(claudeSessionId?: string)` in `domain/tab-config.ts`:
```ts
function tabConfigToWindowSpec(claudeSessionId?: string) {
  return (tab: TabConfig, idx: number, all: TabConfig[]): WindowSpec => {
    if (tab.kind === 'claude') {
      const isFirstClaude = all.findIndex((t) => t.kind === 'claude') === idx;
      return {
        name: tab.name,
        kind: 'claude',
        ...(tab.args ? { args: tab.args } : {}),
        ...(isFirstClaude && claudeSessionId ? { claudeSessionId } : {}),
      };
    }
    return {
      name: tab.name,
      kind: 'command',
      ...(tab.command ? { command: tab.command } : {}),
    };
  };
}
```

Only the *first* claude-kind tab gets the tracked `claudeSessionId` — secondary claude tabs (rare) start fresh.

`buildWindowSpecs` is rewritten:
```ts
function buildWindowSpecs(
  type: SessionType,
  workspace: Workspace | null,
  preferences: Preferences,
  gustavTmuxEntries: string[],   // slice B: still consumed for repo sessions only
  claudeSessionId?: string,
): WindowSpec[] {
  const isRepoSession = type === 'directory' || type === 'worktree';

  // Slice B keeps repo sessions on the legacy path until slice C
  if (isRepoSession) {
    return legacyRepoSessionSpecs(gustavTmuxEntries, claudeSessionId);
  }

  const list = workspace?.defaultTabs ?? preferences.defaultTabs ?? [];
  const filtered = list.filter((t) => t.appliesTo === 'standalone' || t.appliesTo === 'both');
  return filtered.map(tabConfigToWindowSpec(claudeSessionId));
}
```

`legacyRepoSessionSpecs` is the current `buildWindowSpecs` body for `directory` / `worktree` (Claude Code + Git + Shell + .gustav extras). It will be removed when slice C migrates `.gustav`.

### Storage

| Scope | File | Field |
|---|---|---|
| Global | `preferences.json` | `defaultTabs?: TabConfig[]` |
| Per-workspace | `workspaces.json` (existing) | `Workspace.defaultTabs?: TabConfig[]` |

Both writes go through the existing service write-queues.

### IPC channels

| Channel | Direction | Notes |
|---|---|---|
| `GET_PREFERENCES` (existing) | renderer → main | Already returns `Preferences`; now includes `defaultTabs`. |
| `SET_PREFERENCE` (existing) | renderer → main | Reused for individual settings. New variant for the tabs list (see below). |
| `SET_DEFAULT_TABS` (new) | renderer → main | Whole-list write to globals. Body: `TabConfig[]`. |
| `SET_WORKSPACE_DEFAULT_TABS` (new) | renderer → main | Body: `{ workspaceId: string, tabs: TabConfig[] \| null }`. `null` removes the override. |

`SET_DEFAULT_TABS` is a separate channel rather than reusing `SET_PREFERENCE` because the list-replacement semantics (atomic write of the full list) are awkward to express through the per-key preference channel.

### Renderer

| File | Change |
|---|---|
| `src/renderer/components/settings/SettingsSidebar.tsx` | New nav item "Default Tabs" between "Appearance" and "Remote". |
| `src/renderer/components/settings/SettingsView.tsx` | New section branch `{section === 'default-tabs' && <DefaultTabsSettings />}`. |
| `src/renderer/components/settings/DefaultTabsSettings.tsx` (new) | Loads globals via `getPreferences`; renders `<DefaultTabsList showAppliesTo />`; saves via `setDefaultTabs`. |
| `src/renderer/components/settings/DefaultTabsList.tsx` (new) | Shared editor: reorderable rows with name/kind/command/args/appliesTo controls; add/delete buttons; drag handle (reuse `SortableItem` from `WorkspaceAccordion`). `showAppliesTo` prop hides the appliesTo column for the workspace dialog use case. |
| `src/renderer/components/sidebar/WorkspaceAccordion.tsx` | Append "Edit settings" item to the workspace right-click context menu (existing menu only has "Delete Workspace"). |
| `src/renderer/components/workspace/WorkspaceSettingsDialog.tsx` (new) | shadcn Dialog wrapping `<DefaultTabsList showAppliesTo={false} />`. Loads `workspace.defaultTabs`; saves via `setWorkspaceDefaultTabs`; "Reset to defaults" button calls the same channel with `tabs: null`. |
| `src/preload/index.ts` + `api.d.ts` | Expose `setDefaultTabs(tabs)` and `setWorkspaceDefaultTabs(workspaceId, tabs)` on `window.api`. |

### Out of scope

- Repo (`.gustav`) override migration — slice C.
- "Reset to defaults" UX in the global Settings page (only the workspace dialog has it; globals are the floor).
- Validation of tab names for uniqueness; tmux allows duplicates and renames silently. Acceptable in slice B.
- Drag-reorder cross-list (no global ↔ workspace drag).

## 4. Acceptance Criteria

| # | Criterion | Verification |
|---|---|---|
| B1 | A user with no prior config sees Claude(both) + Git(repository) + Shell(both) as seeded global defaults after upgrade. | First-launch test on clean userData. |
| B2 | Global tab edits reach disk in `preferences.json` and survive a restart. | Persistence test. |
| B3 | A workspace-type session uses workspace.defaultTabs when set, else global defaults, with `appliesTo` filter ('standalone' or 'both'). | Unit + integration test on `buildWindowSpecs`. |
| B4 | Clearing all rows in the workspace dialog removes the override entry; the next session falls back to globals. | Unit test on `setWorkspaceDefaultTabs(id, null)` semantics. |
| B5 | Repo (directory/worktree) sessions in slice B still produce Claude + Git + Shell + .gustav `[tmux]` tabs. | Existing repo-session tests stay green. |
| B6 | Right-click on a workspace header offers Edit settings; the modal opens; Esc/outside-click closes without saving. | Manual + Playwright (if available). |
| B7 | Removing the Claude tab from globals is allowed; new workspace sessions then have no Claude tab and no error logged. | Manual test. |
| B8 | The workspace settings editor never lets a user create a row with `appliesTo` other than `'standalone'`. | Component test asserts saved row has appliesTo='standalone'. |
| B9 | Slice A's `WindowSpec.kind`/`args` flow correctly through `tabConfigToWindowSpec`; sleep/wake of a Claude tab from slice B's defaults preserves resume. | Integration test composing B on top of A. |
| B10 | "Edit settings" context menu item appears only for real workspaces, not for the default `_standalone` accordion. | Component test. |

## 5. Consistency Gate

- [x] Intent unambiguous.
- [x] Every behavior in the intent has a Gherkin scenario.
- [x] Architecture changes only what intent requires (no schema versioning, no migration tooling beyond seeding).
- [x] Names consistent: `defaultTabs`, `TabConfig`, `appliesTo`.
- [x] No artifact contradicts another. Slice C will replace the `legacyRepoSessionSpecs` path; until then it stays.

**Gate: PASS.** Implementation plan: `plans/default-tabs.md`.
