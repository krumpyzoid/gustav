# Plan: Repository Config (Slice C)

**Created**: 2026-04-27
**Branch**: main
**Status**: approved

## Goal

Replace the `.gustav` file with a user-scope per-repository config edited from a right-click → Edit Settings modal on repo headers. Migrate `[env]`, `[tmux]`, `[install]`, `[new] base` into the new schema (`RepoConfig`); drop `[copy]` and `[hooks]` entirely. Retire `ConfigService` and the `.gustav` reader from production paths.

## Spec Reference

`docs/specs/repo-config.md`. Final shape:

```ts
type RepoConfig = {
  tabs?: TabConfig[];
  env?: Record<string, string>;
  postCreateCommand?: string;
  baseBranch?: string;
};
```

## Acceptance Criteria

- [ ] `RepoConfigService` reads/writes `~/.local/share/gustav/repo-overrides.json` keyed by repoRoot
- [ ] `importFromGustav(repoRoot)` returns a `RepoConfig` from a `.gustav` file (used only at first-open of the dialog)
- [ ] Repo (directory/worktree) sessions resolve tabs from `repoConfig.tabs ?? preferences.defaultTabs`, filtered by `appliesTo ∈ {repository, both}`
- [ ] `WorktreeService.create` reads from `RepoConfig` (env / postCreateCommand / baseBranch); `[copy]` and `[hooks]` are gone; `install` boolean parameter is gone
- [ ] `getCleanCandidates` skips repos without `baseBranch`; uses it as the merge target
- [ ] New IPC channels: `GET_REPO_CONFIG`, `SET_REPO_CONFIG`, `GET_REPO_CONFIG_IMPORT`
- [ ] `RepoSettingsDialog` (new) renders four sections (Tabs, Environment, Post-Create Command, Base Branch) and pre-populates from `.gustav` on first open
- [ ] Right-click on repo header in sidebar offers "Edit settings"
- [ ] New Worktree dialog has no "Install on create" checkbox
- [ ] `ConfigService`, `GustavConfig`, `cleanMergedInto`, `runHook`, and all `[copy]`/`[hooks]` code are removed
- [ ] All tests pass; new tests cover the service, importer, and dialog flows

## Steps

### Step 1: `RepoConfigService` + `importFromGustav` parser

**Complexity**: complex
**RED**: New `src/main/services/__tests__/repo-config.service.test.ts`. Cover:
- `get(repoRoot)` returns `null` when no override
- `set(repoRoot, config)` persists; `get` returns it
- `set(repoRoot, null)` removes the entry from disk
- `list()` returns all overrides
- Corrupt JSON file → `get` returns `null`, no throw
- `importFromGustav(repoRoot)` reads `.gustav`, returns `RepoConfig` with tabs, env, postCreateCommand, baseBranch derived from `[tmux]`, `[env]`, `[install] cmd=`, `[new] base=`
- `importFromGustav` returns `null` if no `.gustav` file
- `importFromGustav` ignores `[copy]`, `[hooks]`, `[clean]` (by design)
- `importFromGustav` produces tab `id`s via uuid; `appliesTo: 'repository'` for imported tabs

**GREEN**: New `src/main/services/repo-config.service.ts`. Storage: `~/.local/share/gustav/repo-overrides.json`. In-memory cache; write-queue mirroring `WorkspaceService`. The `.gustav` parser is inlined (~30 lines, INI-like, only the four relevant sections).

**REFACTOR**: None.

**Files**: `src/main/services/repo-config.service.ts`, `src/main/services/__tests__/repo-config.service.test.ts`

**Commit**: `feat(repo-config): RepoConfigService with .gustav import path`

---

### Step 2: Wire `buildWindowSpecs` for repo sessions to consume `RepoConfig.tabs`

**Complexity**: standard
**RED**: Extend `src/main/ipc/__tests__/build-window-specs.test.ts`:
- Repo session with `repoConfig.tabs = [{...}]` → uses override list, filtered by repository scope
- Repo session with no override → uses `preferences.defaultTabs`, filtered by repository scope
- `gustavTmuxEntries` parameter is no longer consumed (slice C removes the legacy path)

**GREEN**:
- Update `BuildWindowSpecsArgs`: add `repoConfig: RepoConfig | null`. Remove `gustavTmuxEntries`.
- Replace the `legacyRepoWindowSpecs` branch with the resolver shown in the spec (`override?.tabs ?? preferences.defaultTabs`, `filterTabsByScope(_, 'repository')`, map).
- Update the four call sites in `handlers.ts`: stop calling `configService.parse`; load `repoConfig` for repo sessions via the new service (using the session's `repoRoot`).

**REFACTOR**: Delete `legacyRepoWindowSpecs`.

**Files**: `src/main/ipc/build-window-specs.ts`, `src/main/ipc/__tests__/build-window-specs.test.ts`, `src/main/ipc/handlers.ts`

**Commit**: `feat(handlers): repo sessions resolve tabs from RepoConfig and globals`

---

### Step 3: `WorktreeService` consumes `RepoConfig` (drop hooks/copy/install boolean)

**Complexity**: complex
**RED**: Update `worktree.service.test.ts` covering:
- `create` writes a `.env` from `repoCfg.env`
- `create` runs `postCreateCommand` (always, when set) via `sh -c '...'` in worktree dir
- `create` does NOT copy `[copy]` files
- `create` does NOT call any hook
- `create` uses `userProvidedBase || repoCfg.baseBranch || 'origin/main'` as the worktree-add base
- `getCleanCandidates` returns no candidates for a repo with no `baseBranch`
- `getCleanCandidates` uses `repoCfg.baseBranch` as the merge target

**GREEN**:
- Replace `private config: ConfigService` dependency with `private repoConfig: RepoConfigService`.
- `create()` signature: drop the `install: boolean` parameter (callers updated next step).
- Remove all `runHook` calls and the private method itself.
- Remove the `[copy]` loop.
- `[install]` block becomes: if `repoCfg?.postCreateCommand`, run it (no checkbox guard).
- `getCleanCandidates`: load `repoCfg = repoConfig.get(repoRoot)`; if no `baseBranch`, `continue`; else use it as `mergedInto`.

**REFACTOR**: Delete `runHook` method.

**Files**: `src/main/services/worktree.service.ts`, `src/main/services/__tests__/worktree.service.test.ts`

**Commit**: `feat(worktree): consume RepoConfig; drop hooks, copy, install checkbox`

---

### Step 4: IPC channels + preload bridge

**Complexity**: standard
**RED**: Indirect via service tests in step 1.

**GREEN**:
- `src/main/ipc/channels.ts`: add `GET_REPO_CONFIG`, `SET_REPO_CONFIG`, `GET_REPO_CONFIG_IMPORT`.
- `src/main/ipc/handlers.ts`: register handlers; validate payloads.
- Update `CREATE_WORKTREE` handler: drop `install` from params (the boolean has no UI source after step 7).
- `src/preload/index.ts` + `api.d.ts`: expose `getRepoConfig(repoRoot)`, `setRepoConfig(repoRoot, config|null)`, `getRepoConfigImport(repoRoot)`.

**REFACTOR**: None.

**Files**: `src/main/ipc/channels.ts`, `src/main/ipc/handlers.ts`, `src/preload/index.ts`, `src/preload/api.d.ts`, `src/main/domain/types.ts` (CreateWorktreeParams loses `install`).

**Commit**: `feat(ipc): expose repo config channels; drop install param from worktree create`

---

### Step 5: `RepoSettingsDialog` component

**Complexity**: complex
**RED**: New `src/renderer/components/repo/__tests__/RepoSettingsDialog.test.tsx`. Cover:
- Renders four sections: Tabs, Environment, Post-Create Command, Base Branch
- Tabs section: uses `<DefaultTabsList showAppliesTo={false} />`; rows saved with `appliesTo: 'repository'`
- Environment: add/edit/delete key/value rows
- Base Branch: select populated from `getBranches`; supports clearing
- First-open with no override and a `.gustav` file: imports and shows banner; Save persists override
- "Reset to defaults": calls `setRepoConfig(repoRoot, null)` and closes

**GREEN**: New file with shadcn Dialog wrapper, the four sections, and the load-or-import flow.

**REFACTOR**: If env editor reuses tab editor patterns (drag-handle not needed; just rows), it stays simple inline rather than extracted.

**Files**: `src/renderer/components/repo/RepoSettingsDialog.tsx`, `src/renderer/components/repo/__tests__/RepoSettingsDialog.test.tsx`

**Commit**: `feat(repo): RepoSettingsDialog with all four config sections`

---

### Step 6: Right-click on repo header → context menu → Edit Settings

**Complexity**: standard
**RED**: Manual smoke + visual verification (the existing workspace context-menu pattern is the reference).

**GREEN**:
- In `WorkspaceAccordion.tsx` `RepoGroup`: add `onContextMenu` handler with the same context-menu pattern used at the workspace header. Add `onEditSettings?: (repoRoot: string) => void` prop.
- Wire `onEditSettings` through `WorkspaceAccordion` props → `Sidebar` → `App.tsx`.
- `App.tsx`: own `repoSettingsRoot: string | null` state; render `<RepoSettingsDialog repoRoot={...} open={...} onOpenChange={...} />` at the bottom.

**REFACTOR**: None.

**Files**: `src/renderer/components/sidebar/WorkspaceAccordion.tsx`, `src/renderer/components/sidebar/Sidebar.tsx`, `src/renderer/App.tsx`

**Commit**: `feat(repo): right-click on repo header opens Edit Settings`

---

### Step 7: NewWorktreeDialog — drop "Install on create" checkbox

**Complexity**: trivial
**RED**: Manual smoke. (No automated dialog test today; bound to the visible behavior.)

**GREEN**: Open `NewWorktreeDialog.tsx`; remove the checkbox JSX, the `install` state, and the param from the IPC call.

**REFACTOR**: None.

**Files**: `src/renderer/components/dialogs/NewWorktreeDialog.tsx`

**Commit**: `feat(worktree): remove install-on-create checkbox`

---

### Step 8: Delete `ConfigService` and all `.gustav` reader code

**Complexity**: complex
**RED**: Existing tests stay green; one new sanity test asserts `import` of `ConfigService` no longer resolves.

**GREEN**:
- Delete `src/main/services/config.service.ts`.
- Delete `src/main/services/__tests__/config.service.test.ts`.
- Delete the `GustavConfig` type from `src/main/domain/types.ts`.
- Remove `configService` from the dep object in `handlers.ts` and from `index.ts`.
- Remove every remaining call site (`configService.parse(...)`); replace with `repoConfigService.get(...)` if not already done by step 2.
- Remove `cleanMergedInto` references entirely.

**REFACTOR**: Tighten any imports made stale by the deletion.

**Files**: 5–8 files; mostly deletions and grep-driven removals.

**Commit**: `chore(repo-config): retire ConfigService and .gustav reader`

---

### Step 9: Final verification

**Complexity**: trivial
**GREEN**:
1. `npx vitest run` — all green.
2. `npx tsc --build` — no new errors.
3. Manual smoke: right-click repo → Edit Settings → import banner → save → next session uses override; reset → falls back to globals; new worktree honors postCreateCommand and baseBranch; cleanup skips repos without baseBranch.

**Files**: none.

**Commit**: none.

---

## Complexity Classification

| Step | Rating | Reasoning |
|------|--------|-----------|
| 1 | complex | New service, persistence, .gustav parser, write-queue |
| 2 | standard | Resolver update + 4 call-site edits |
| 3 | complex | Worktree service rewrite — multiple removals, semantic changes |
| 4 | standard | IPC + preload glue |
| 5 | complex | New dialog with four distinct sections, async loads, branches select |
| 6 | standard | Context menu + prop chain |
| 7 | trivial | Single-component checkbox removal |
| 8 | complex | Cross-cutting deletion; must catch every consumer |
| 9 | trivial | Verification |

## Pre-PR Quality Gate

- [ ] `npx vitest run` green
- [ ] `npx tsc --build` clean (main/preload)
- [ ] Manual smoke: import → save → session uses override
- [ ] Manual smoke: reset → fallback to globals
- [ ] Manual smoke: new worktree honors all four fields
- [ ] Manual smoke: cleanup skips repos without baseBranch
- [ ] grep `ConfigService\|GustavConfig\|\.gustav` in src/ shows only the inlined import parser, slice docs, and removed-code comments

## Risks & Open Questions

- **Risk — `WorktreeService` `install` param touches multiple call sites**: `IpcMain.CREATE_WORKTREE` accepts an `install` flag from the renderer; `CreateWorktreeParams` has it; the New Worktree dialog passes it. Step 4 + 7 must remove all references in lockstep, or the typecheck fails. *Mitigation*: do step 4 and 7 in the same sitting; verify with `tsc` between commits.
- **Risk — `cleanMergedInto` default semantics change silently**: Today, repos without `[clean]` use `'origin/staging'` as the merge target; after slice C, they produce no candidates. Power users relying on the implicit default will see fewer cleanup suggestions. *Mitigation*: documented in the spec; the user accepted this trade-off; they can set `baseBranch` per-repo to restore behavior.
- **Risk — `.gustav` import conflicts with Tab IDs**: Imported tabs need stable IDs; reuse the `crypto.randomUUID()` approach from slice B's seed. *Mitigation*: documented in step 1.
- **Risk — Concurrent write to `repo-overrides.json`**: Like `WorkspaceService`, the new service uses a write-queue. *Mitigation*: mirror the existing pattern.
- **Open question — Where to fetch `repoRoot` for the `buildWindowSpecs` resolver call**: At the four `handlers.ts` call sites, `repoRoot` is available locally for repo sessions. Workspace sessions don't have one; pass `null`. *Decision*: explicit; resolver receives `repoConfig: RepoConfig | null`.
- **Open question — Should empty Tabs imply "use globals"**: An override with `tabs: []` has two interpretations: (a) "no tabs at all" or (b) "fall through to globals". Slice B's `setWorkspaceDefaultTabs([])` chose (b). For consistency, slice C does the same: an empty `tabs` array (or omitted field) → fall through to globals. *Decision*: yes, mirror slice B.
