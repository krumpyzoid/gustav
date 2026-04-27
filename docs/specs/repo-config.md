# Spec: Repository Config (Slice C)

## 1. Intent Description

Replace the `.gustav` file with a user-scope per-repository config edited through a modal opened from a right-click on a repository header in the sidebar. Storage moves out of the repo (where it lived gitignored) into `~/.local/share/gustav/repo-overrides.json` keyed by `repoRoot`.

The schema is simplified to four fields:

```ts
type RepoConfig = {
  tabs?: TabConfig[];                     // override globals for this repo's sessions
  env?: Record<string, string>;           // written to .env in new worktrees
  postCreateCommand?: string;             // sh -c'd in the new worktree after creation
  baseBranch?: string;                    // base for `git worktree add` AND merge target for cleanup
};
```

Three current `.gustav` features go away:
- `[copy]` — users can `cp` in `postCreateCommand` if needed
- `[hooks]` (pre_new/post_new/pre_rm/post_rm/pre_clean/post_clean) — no proven requirement; reintroduce later if needed
- the "Install on create" checkbox in the New Worktree dialog — `postCreateCommand` is always run when set

The cleanup-merged-worktrees feature now requires `baseBranch` to be set; repos without it produce no candidates.

This slice retires `ConfigService` and the `.gustav` file reader entirely. A one-shot import path lets users pre-populate the modal from an existing `.gustav` file on first open.

## 2. User-Facing Behavior (Gherkin)

```gherkin
Feature: Per-repository configuration via right-click

  Scenario: Right-click on a repo header opens Edit Settings
    Given a workspace contains a pinned repo "gustav"
    When the user right-clicks the "gustav" repo header
    Then a context menu shows "Edit settings"
    When the user selects "Edit settings"
    Then a modal opens with sections: Tabs, Environment, Post-Create Command, Base Branch

  Scenario: First-time open of a repo with a .gustav file pre-populates the modal
    Given a repo has a .gustav file with [env], [tmux], [new] base, [install] cmd
    And no user-scope override exists yet for that repo
    When the user opens Edit settings
    Then the modal pre-populates Tabs from the .gustav [tmux] entries
    And Environment from [env]
    And Post-Create Command from [install] cmd
    And Base Branch from [new] base
    And a banner indicates "Imported from .gustav (review and save)"

  Scenario: Saving the imported config writes user-scope override
    Given the user reviewed the pre-populated config
    When the user clicks Save
    Then the config is written to ~/.local/share/gustav/repo-overrides.json keyed by repoRoot
    And subsequent sessions for that repo read from the override
    And the .gustav file is not deleted (user removes it manually)

  Scenario: Repo with no override and no .gustav uses global defaults
    Given a repo has no override and no .gustav file
    When a directory or worktree session is created
    Then the session opens with the global default tabs filtered by appliesTo "repository" or "both"
    And no env file is written, no post-create command runs

  Scenario: Repo override tabs replace global defaults for that repo's sessions
    Given a repo override has tabs of one entry "Tests" running "npm test"
    When a directory session is created for that repo
    Then the session opens with one tab "Tests"

  Scenario: Worktree creation honors the new fields
    Given a repo override has env { FOO: "bar" }, postCreateCommand "npm install", baseBranch "origin/develop"
    When the user creates a new worktree for branch "feature/x"
    Then `git worktree add ... feature/x origin/develop` runs (when the branch is new)
    And a .env containing "FOO=bar\n" is written into the worktree
    And `sh -c 'npm install'` runs in the worktree directory
    And no [copy] step runs
    And no hooks fire

  Scenario: Cleanup uses baseBranch as the merge target
    Given a repo override has baseBranch "origin/main"
    When the cleanup-merged feature runs
    Then a worktree branch is returned only if it is fully merged into origin/main

  Scenario: Cleanup skips repos without a baseBranch
    Given a repo override has no baseBranch set
    When the cleanup-merged feature runs
    Then the repo contributes no candidates
    And no error is logged

  Scenario: Reset to defaults removes the override
    Given a repo has an override
    When the user clicks "Reset to defaults" and confirms
    Then the entry is removed from repo-overrides.json
    And future sessions use global defaults
    And future worktree creations use no env, no post-create, baseBranch fallback "origin/main"

  Scenario: Base Branch field is a select of existing branches
    Given the user opens Edit settings for a repo
    When the user clicks the Base Branch field
    Then the local and remote-tracking branches of the repo are listed
    And the user can clear the selection

  Scenario: New Worktree dialog has no "Install on create" checkbox
    Given the user opens the New Worktree dialog
    Then no "Install on create" checkbox is visible
    And postCreateCommand always runs after creation when set

  Scenario: ConfigService and .gustav reading code are removed
    Given the application has been upgraded past slice C
    Then no production code path reads any .gustav file
    And ConfigService no longer exists
```

## 3. Architecture Specification

### Domain types

```ts
// src/main/domain/repo-config.ts (new)
export type RepoConfig = {
  tabs?: TabConfig[];
  env?: Record<string, string>;
  postCreateCommand?: string;
  baseBranch?: string;
};
```

### Storage

- New file `~/.local/share/gustav/repo-overrides.json`, shape `{ overrides: Record<repoRoot, RepoConfig> }`.
- New service `RepoConfigService` with: `get(repoRoot)`, `set(repoRoot, config | null)` (null deletes), `list()`, and `importFromGustav(repoRoot): RepoConfig | null` — the import helper inlines a tiny `.gustav` parser so it doesn't depend on the deleted `ConfigService`.

### Resolution (replaces slice B's repo-session legacy path)

In `buildWindowSpecs` for repo-type sessions (`directory` | `worktree`):
```ts
const repoRoot = workspace?.directory ?? ...;  // see call sites below
const override = repoConfig.get(repoRoot);
const list = override?.tabs ?? preferences.defaultTabs ?? [];
return filterTabsByScope(list, 'repository').map(tabConfigToWindowSpec(claudeSessionId));
```

The repo's `repoRoot` is already known at the call site (it's the session directory for `directory`/`worktree` types).

### Worktree service (`src/main/services/worktree.service.ts`)

- `[copy]` loop: **deleted**.
- `[hooks]` calls (`runHook` invocations at lines 50, 84, 93, 113, 197, 217): **all deleted**.
- `config.env` → `repoCfg?.env ?? {}`. Special-case "if no env override, copy `.env` from repo root" is preserved — that's slice C unchanged.
- Hardcoded copy of `.claude/settings.local.json` is preserved (out of scope).
- `install` parameter + `config.install` → `repoCfg?.postCreateCommand` (always run if set; the `install` boolean parameter to `WorktreeService.create` is removed).
- `config.base` → `repoCfg?.baseBranch ?? 'origin/main'` (worktree-add fallback).
- `getCleanCandidates` (`worktree.service.ts:116`): for each repo, `if (!repoCfg?.baseBranch) continue;`. The previous `'origin/staging'` default is removed.

### IPC (new channels)

| Channel | Body | Returns |
|---|---|---|
| `GET_REPO_CONFIG` | `repoRoot: string` | `RepoConfig \| null` |
| `SET_REPO_CONFIG` | `repoRoot: string, config: RepoConfig \| null` | `Result<void>` |
| `GET_REPO_CONFIG_IMPORT` | `repoRoot: string` | `RepoConfig \| null` (reads `.gustav` if present, does NOT save) |

`GET_BRANCHES` (existing) is reused for the Base Branch select.

### Renderer

| File | Change |
|---|---|
| `src/renderer/components/sidebar/WorkspaceAccordion.tsx` (RepoGroup) | Add right-click handler with context menu → "Edit settings". Mirror the workspace-context-menu pattern. |
| `src/renderer/components/repo/RepoSettingsDialog.tsx` (new) | shadcn `<Dialog>` with four sections. Tabs reuses `<DefaultTabsList showAppliesTo={false} />` (forced `appliesTo='repository'` on save). Env is a key/value list. Post-Create Command is a single-line text input. Base Branch is a `<select>` populated from `window.api.getBranches(repoRoot)` plus an empty/cleared option. "Reset to defaults" calls `setRepoConfig(repoRoot, null)`. On first open with no override, calls `getRepoConfigImport(repoRoot)` and pre-populates if non-null; shows the imported-banner. |
| `src/renderer/components/dialogs/NewWorktreeDialog.tsx` | Remove the "Install on create" checkbox. Pass-through is unchanged otherwise. |
| `src/renderer/App.tsx` | Wire `onEditRepoSettings` from sidebar, own dialog state. |

### Removed code (must not survive slice C)

- `src/main/services/config.service.ts` — deleted.
- `src/main/services/__tests__/config.service.test.ts` — deleted.
- `GustavConfig` type in `src/main/domain/types.ts` — deleted.
- All `configService.parse(...)` call sites in handlers — replaced with `repoConfigService.get(...)`.
- `runHook` private method on `WorktreeService`, all `[copy]` logic, all `[hooks]` calls.
- `install` parameter from `WorktreeService.create` and the IPC plumbing that carries it.
- `cleanMergedInto` field — no replacement (subsumed by `baseBranch`).

### Out of scope for slice C

- Auto-deleting `.gustav` files after migration — user removes them manually.
- Validation of `baseBranch` against actual git refs (we trust the select; users can also clear).
- A per-environment-variable validator. Users may type freely.

## 4. Acceptance Criteria

| # | Criterion | Verification |
|---|---|---|
| C1 | After slice C, no production code path reads `.gustav` files; `ConfigService` no longer exists. | grep returns only the inlined `importFromGustav` parser and tests/docs. |
| C2 | First open of Edit Settings for a repo with a `.gustav` pre-populates all four fields; user must explicitly Save to commit. | E2E with fixture `.gustav`; Service unit test for `importFromGustav`. |
| C3 | A repo override's `tabs` fully replaces global defaults for that repo's sessions; without an override, repo sessions consume globals filtered by `appliesTo` ∈ {repository, both}. | `buildWindowSpecs` unit tests. |
| C4 | Worktree creation runs `postCreateCommand` (when set) regardless of any UI checkbox; the New Worktree dialog has no "Install on create" checkbox. | UI inspection + worktree-create unit test. |
| C5 | Worktree creation no longer copies `[copy]` files and no longer fires hooks. Hardcoded `.env`/`.claude/settings.local.json` copies still run. | grep + `worktree.service.test.ts`. |
| C6 | `baseBranch` is used by `git worktree add` (chain: userProvidedBase → baseBranch → 'origin/main') AND as the merge target in `getCleanCandidates`. Repos with no `baseBranch` produce zero clean candidates. | Two unit tests. |
| C7 | "Reset to defaults" deletes the override; next session uses globals; next worktree create uses no env, no post-create, fallback baseBranch. | Service unit test + manual smoke. |
| C8 | The repo Edit Settings dialog Base Branch field lists local and remote-tracking branches and supports clearing back to "not set". | Component test. |
| C9 | Slice A and B regressions: Claude tabs in repo overrides still resume; global default tabs still flow through for repos without overrides. | Existing tests stay green. |
| C10 | `repo-overrides.json` corruption (invalid JSON) does not crash the app — `RepoConfigService` returns no overrides; error logged. | Resilience test. |

## 5. Consistency Gate

- [x] Intent unambiguous.
- [x] Every behavior in the intent has a Gherkin scenario.
- [x] Architecture changes only what intent requires.
- [x] Names consistent: `tabs`, `env`, `postCreateCommand`, `baseBranch`, `RepoConfig`, `repo-overrides.json`.
- [x] No artifact contradicts another. Worktree-add `'origin/main'` fallback (when both user-provided base and `baseBranch` are unset) is documented separately from the cleanup behavior (which has no fallback).

**Gate: PASS.** Implementation plan: `plans/repo-config.md`.
