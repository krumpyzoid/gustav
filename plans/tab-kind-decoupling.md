# Plan: Tab Kind Decoupling (Slice A)

**Created**: 2026-04-27
**Branch**: main
**Status**: approved

## Goal

Make "this is a Claude tab" an explicit `kind` field on `WindowSpec` instead of a `command === 'claude'` string match. Today, `buildRestoreCommand()` (`src/main/services/session.service.ts:9-18`) only attaches `--resume <id>` when `spec.command === 'claude'` exactly, so any flag (`claude --dangerously-skip-permissions`) makes the check miss and the command is replayed verbatim on wake — losing Claude session continuity. After this slice, the literal command/args are independent of resume logic, and slices B and C can safely let users author Claude tabs with arbitrary flags.

This slice is logic-only: no UI, no IPC channels, no preload changes. Pre-A persisted sessions are intentionally discarded (per spec decision); users kill and start fresh.

## Spec Reference

`docs/specs/tab-kind-decoupling.md`. Key shape:

```ts
type WindowSpec = {
  name: string;
  kind: 'claude' | 'command';
  command?: string;          // kind: 'command'; empty/undefined = shell at cwd
  args?: string;              // kind: 'claude'; freeform claude flags
  claudeSessionId?: string;   // kind: 'claude'
  directory?: string;
};
```

## Acceptance Criteria

- [ ] Claude tabs with arbitrary flags (`--dangerously-skip-permissions`, `--model X`, …) resume via `--resume <id>` after sleep/wake when a `claudeSessionId` is tracked
- [ ] When no `claudeSessionId` is tracked, the Claude tab launches as bare `claude` (plus any user args) — no `--continue` is added
- [ ] User-supplied `--resume X` or `--continue` in `args` is stripped (Gustav owns Claude session continuity); whitespace-token based, `=` form not supported (documented)
- [ ] A `kind: 'command'` tab with no `command` opens an empty shell at the tab's `directory`
- [ ] Pre-A persisted sessions (entries without `kind` on every window) are silently dropped at app start; remaining workspaces load cleanly
- [ ] All three (workspace/directory/worktree) `launchSession` methods route Claude-tab command construction through a single `composeClaudeCommand` helper — no remaining `\`claude --resume ${...}\`` template literals in launch code
- [ ] No new IPC channels, no preload changes, no renderer changes (except `WindowSpec` type imports)
- [ ] Existing snapshot/restore unit tests pass; updated tests use `kind` explicitly
- [ ] `normalizeWindows` and the `(string | WindowSpec)[]` union are removed from `PersistedSession.windows`

## Steps

### Step 1: Pure helpers — `composeClaudeCommand` and `stripResumeContinueFlags`

**Complexity**: standard
**RED**: New test file `src/main/domain/__tests__/claude-command.test.ts`. Cover:
- `stripResumeContinueFlags('')` → `''`
- `stripResumeContinueFlags('--dangerously-skip-permissions')` → `'--dangerously-skip-permissions'`
- `stripResumeContinueFlags('--resume abc')` → `''`
- `stripResumeContinueFlags('--continue')` → `''`
- `stripResumeContinueFlags('--resume abc --foo bar')` → `'--foo bar'`
- `stripResumeContinueFlags('--foo --resume abc --bar --continue')` → `'--foo --bar'`
- `stripResumeContinueFlags('--resume')` (no token after) → `''`
- `composeClaudeCommand({ kind: 'claude' })` → `'claude'`
- `composeClaudeCommand({ kind: 'claude', claudeSessionId: 'abc' })` → `'claude --resume abc'`
- `composeClaudeCommand({ kind: 'claude', args: '--dangerously-skip-permissions' })` → `'claude --dangerously-skip-permissions'`
- `composeClaudeCommand({ kind: 'claude', args: '--dangerously-skip-permissions', claudeSessionId: 'abc' })` → `'claude --dangerously-skip-permissions --resume abc'`
- `composeClaudeCommand({ kind: 'claude', args: '--resume bogus' })` → `'claude'` (stripped, no id ⇒ no resume tail)
- `composeClaudeCommand({ kind: 'claude', args: '--resume bogus --foo', claudeSessionId: 'abc' })` → `'claude --foo --resume abc'`
- `composeClaudeCommand({ kind: 'claude', args: '--continue', claudeSessionId: 'abc' })` → `'claude --resume abc'`
- `composeClaudeCommand({ kind: 'claude', args: '--continue' })` → `'claude'`

**GREEN**: Create `src/main/domain/claude-command.ts` exporting both helpers as pure functions. Take a partial-shape input for `composeClaudeCommand` (only the fields it needs: `args`, `claudeSessionId`) — keep the function decoupled from the full `WindowSpec` type so it stays trivially testable.

**REFACTOR**: None. Pure functions, no duplication yet.

**Files**: `src/main/domain/claude-command.ts`, `src/main/domain/__tests__/claude-command.test.ts`

**Commit**: `feat(domain): add composeClaudeCommand and stripResumeContinueFlags helpers`

---

### Step 2: Add optional `kind` and `args` to `WindowSpec` + isValidWindowSpec guard

**Complexity**: standard
**RED**: Extend `src/main/domain/__tests__/types.test.ts`:
- `isValidWindowSpec({ name: 'X', kind: 'claude' })` → `true`
- `isValidWindowSpec({ name: 'X', kind: 'command' })` → `true`
- `isValidWindowSpec({ name: 'X' })` → `false` (no kind)
- `isValidWindowSpec({ name: 'X', kind: 'claude', args: '--x' })` → `true`
- `isValidWindowSpec('legacy-string')` → `false`
- `isValidWindowSpec(null)` → `false`

**GREEN**: In `src/main/domain/types.ts`:
- Add `kind?: 'claude' | 'command'` and `args?: string` to `WindowSpec` (still optional at this step to keep the codebase compiling).
- Add and export `isValidWindowSpec(w: unknown): w is WindowSpec` checking `name` is a non-empty string and `kind` is one of the two literals.

Keep `normalizeWindows` and the union type for now — they stop being needed in step 6.

**REFACTOR**: None.

**Files**: `src/main/domain/types.ts`, `src/main/domain/__tests__/types.test.ts`

**Commit**: `feat(domain): add kind/args fields and isValidWindowSpec guard to WindowSpec`

---

### Step 3: `buildRestoreCommand` switches on `kind`

**Complexity**: standard
**RED**: Extend `src/main/services/__tests__/session.service.test.ts` `buildRestoreCommand` block (currently lines ~300-325). Add:
- `{ kind: 'claude', claudeSessionId: 'abc' }` → `'claude --resume abc'`
- `{ kind: 'claude' }` → `'claude'` (no flag added when no id)
- `{ kind: 'claude', args: '--dangerously-skip-permissions', claudeSessionId: 'abc' }` → `'claude --dangerously-skip-permissions --resume abc'`
- `{ kind: 'claude', args: '--dangerously-skip-permissions' }` → `'claude --dangerously-skip-permissions'`
- `{ kind: 'claude', args: '--resume bogus' }` → `'claude'` (stripped, no id ⇒ no resume tail)
- `{ kind: 'command', command: 'lazygit' }` → `'lazygit'`
- `{ kind: 'command' }` → `undefined` (shell-only)
- Legacy fallback: `{ name: 'Claude Code', command: 'claude', claudeSessionId: 'abc' }` (no `kind`) → still produces `'claude --resume abc'` (back-compat in step 3 since `kind` is optional). Update the existing back-compat test that expects bare `'claude'` for `{ command: 'claude' }` — keep it.

**GREEN**: Update `buildRestoreCommand` in `session.service.ts` to:
1. If `spec.kind === 'claude'` (or back-compat `spec.command === 'claude'` and no kind), delegate to `composeClaudeCommand`.
2. If `spec.kind === 'command'` or unset, return `spec.command || undefined`.

**REFACTOR**: Inline the import of `composeClaudeCommand`. No further cleanup.

**Files**: `src/main/services/session.service.ts`, `src/main/services/__tests__/session.service.test.ts`

**Commit**: `feat(session): route Claude restore commands through composeClaudeCommand`

---

### Step 4: Refactor `launchWorkspaceSession` / `launchDirectorySession` / `launchWorktreeSession` / `launchStandaloneSession` to use `composeClaudeCommand`

**Complexity**: standard
**RED**: Extend `session.service.test.ts` to assert that for each `launch*Session` method, the Claude-tab `sendKeys` argument equals what `composeClaudeCommand({ kind: 'claude', claudeSessionId })` would produce. New test: pass `claudeSessionId: 'abc'` to a launch method and assert `sendKeys` was called with `'claude --resume abc'`. The existing no-id tests assert bare `'claude'` is sent — keep them as-is (no behavior change for the no-id path).

**GREEN**: In each of the four launch methods in `session.service.ts`:
- Replace the inline `const claudeCmd = claudeSessionId ? \`claude --resume ${claudeSessionId}\` : 'claude';` with:
  ```ts
  const claudeCmd = composeClaudeCommand({ kind: 'claude', claudeSessionId });
  ```
- The first call to `sendKeys(\`${session}:Claude Code\`, claudeCmd)` is unchanged.

**REFACTOR**: All four methods now share the same Claude-cmd construction. Extract a tiny private helper `private claudeCmdFor(claudeSessionId?: string)` returning `composeClaudeCommand({ kind: 'claude', claudeSessionId })` if it reduces noise, otherwise leave inline.

**Files**: `src/main/services/session.service.ts`, `src/main/services/__tests__/session.service.test.ts`

**Commit**: `refactor(session): single-source Claude command construction across launch methods`

---

### Step 5: `snapshotSessionWindows` infers `kind` and preserves `args`

**Complexity**: standard
**RED**: Extend `src/main/ipc/__tests__/snapshot-windows.test.ts`:
- Pre-existing spec `{ name: 'Claude Code', kind: 'claude', args: '--dangerously-skip-permissions', claudeSessionId: 'abc' }`, live pane shows whatever — output preserves all fields.
- New window with `resolveChildCommand` returning `'claude --dangerously-skip-permissions'` → snapshot produces `{ name, kind: 'claude', args: '--dangerously-skip-permissions' }`. No `claudeSessionId` (none was tracked yet).
- New window with `resolveChildCommand` returning `'claude --resume oldid --dangerously-skip-permissions'` → snapshot produces `{ name, kind: 'claude', args: '--dangerously-skip-permissions' }` (resume token stripped).
- New window with `resolveChildCommand` returning `'npm run dev'` → `{ name, kind: 'command', command: 'npm run dev' }`.
- New window with shell at prompt (resolveChildCommand returns null, paneCommand is `zsh`) → `{ name, kind: 'command' }` (no command).

**GREEN**: In `src/main/ipc/snapshot-windows.ts`:
- Drop the `if (existing?.command === 'claude')` branch; replace with `if (existing?.kind === 'claude')` preserving `kind`, `args`, `claudeSessionId`.
- For new windows, after resolving `childCmd` from `resolveChildCommand`, parse it: if the first whitespace-token is `claude`, set `kind: 'claude'` and `args = stripResumeContinueFlags(remainder)` (no `command` field). Otherwise set `kind: 'command'` and `command = childCmd ?? undefined` (shells fall through to no-command).
- Keep existing fallback for non-shell `paneCommand` when `shell` port is absent — emit `{ kind: 'command', command: paneCommand }`.

**REFACTOR**: Extract the kind-inference into a private helper `inferKindFromCommand(cmdLine: string | null, paneCommand: string)` returning `Pick<WindowSpec, 'kind' | 'command' | 'args'>`. Keeps the main loop readable.

**Files**: `src/main/ipc/snapshot-windows.ts`, `src/main/ipc/__tests__/snapshot-windows.test.ts`

**Commit**: `feat(snapshot): infer kind/args from running process during snapshot`

---

### Step 6: Make `kind` required, drop `normalizeWindows`, filter pre-A persisted sessions on load

**Complexity**: complex
**RED**:
1. Update `types.test.ts` — delete the `normalizeWindows` describe block; replace with tests for "WindowSpec.kind is required at the type level" (compile-only assertion via `// @ts-expect-error`).
2. Add a new test in `src/main/services/__tests__/workspace.service.test.ts` (`describe('load', ...)`) asserting that loading a fixture `workspaces.json` containing one valid session and one pre-A session (with `windows: ['Claude Code']` or `windows: [{ name: 'X' }]`) returns workspaces with only the valid session retained. Pre-A sessions are silently dropped — no thrown error, log expected (use a captured stderr or a logger spy).
3. Update all existing tests that consume `WindowSpec` without `kind` to explicitly include `kind` (run typecheck; fix every compile error mechanically).

**GREEN**:
1. In `src/main/domain/types.ts`:
   - Make `kind: 'claude' | 'command'` **required** on `WindowSpec`.
   - Change `PersistedSession.windows` from `(string | WindowSpec)[]` to `WindowSpec[]`.
   - Remove `normalizeWindows` and its export.
2. In `src/main/services/workspace.service.ts` load path: after parsing JSON, for each persisted session, filter `session.windows` through `isValidWindowSpec`. If any window is invalid, drop the entire session (it's not safe to partially restore). Log the drop with the `tmuxSession` name.
3. In every consumer that previously called `normalizeWindows(session.windows)` (search the codebase): remove the call — `windows` is already `WindowSpec[]`. Affected sites likely include: `session.service.ts:restoreSession`, `snapshot-windows.ts`, `handlers.ts:findClaudeSessionId`.
4. Update the four `launch*Session` methods to construct full `WindowSpec` shapes with `kind` when persisting (today they pass strings or partial specs into `workspaceService.persistSession`). Actually most persistence is done inside `snapshotAndPersist`, which after step 5 already produces valid specs — verify and only patch any direct construction sites that bypass snapshot.

**REFACTOR**:
- Remove the `(string | WindowSpec)[]` union from any other type that referenced it.
- Remove unused imports of `normalizeWindows`.
- Verify no `(typeof w === 'string' ? ... : ...)` patterns survive — search for them and delete.

**Files**: `src/main/domain/types.ts`, `src/main/domain/__tests__/types.test.ts`, `src/main/services/workspace.service.ts`, `src/main/services/__tests__/workspace.service.test.ts`, `src/main/services/session.service.ts`, `src/main/ipc/snapshot-windows.ts`, `src/main/ipc/handlers.ts`, plus any other consumer surfaced by the typecheck.

**Commit**: `feat(domain): require kind on WindowSpec; drop normalizeWindows and filter legacy sessions`

---

### Step 7: Manual smoke test + final verification

**Complexity**: trivial
**RED**: N/A — verification step.
**GREEN**:
1. `npm run typecheck` — clean.
2. `npm run lint` — clean.
3. `npm test` — green.
4. Manual smoke (no automated UI test framework in scope here):
   - Start app on a fresh userData dir → create a directory session for any repo → verify Claude Code tab opens with `claude --continue`.
   - Edit the Claude tab to launch with `claude --dangerously-skip-permissions` (manually for now — slice B/C will give UI), let it run, sleep the session, wake the session → verify the tab restarts with `claude --dangerously-skip-permissions --resume <id>` (use `ps` to inspect args of the live process).
   - With a pre-A `workspaces.json` (windows: legacy `string[]` shape), start the app → verify the affected sessions are dropped from the sidebar without crash; valid workspaces still load.

**REFACTOR**: None.

**Files**: none changed; verification only.

**Commit**: none.

---

## Complexity Classification

| Step | Rating | Reasoning |
|------|--------|-----------|
| 1 | standard | New module, pure functions, contained surface |
| 2 | standard | Type extension, additive |
| 3 | standard | Behavior change in single function, well-tested |
| 4 | standard | Refactor of four similar methods, test-covered |
| 5 | standard | Snapshot logic update, contained |
| 6 | complex | Cross-cutting type change, removes a utility, requires fixing every consumer |
| 7 | trivial | Verification only |

## Pre-PR Quality Gate

- [ ] `npm test` — all tests pass
- [ ] `npm run typecheck` — no errors
- [ ] `npm run lint` — clean
- [ ] `/code-review --changed` passes (run after step 6)
- [ ] Manual smoke: vanilla Claude session resumes; Claude session with `--dangerously-skip-permissions` resumes with both flags
- [ ] Manual smoke: pre-A `workspaces.json` loads without crash; legacy sessions dropped
- [ ] No new IPC channels, no preload changes, no renderer behavior changes for non-Claude tabs (diff inspection)

## Risks & Open Questions

- **Risk — Step 5 kind inference for `claude` aliases**: A user with a shell alias or a wrapper script named differently than `claude` (e.g., `cl`, `claude-code`) will be inferred as `kind: 'command'`. *Mitigation*: accept as a known limitation; users using non-standard binaries can fix tabs manually after slice B ships. Out of scope for slice A.
- **Risk — Step 6 dropped sessions**: Users mid-flight with active slept sessions will lose them on upgrade. *Mitigation*: spec accepted this loss. Document in release notes.
- **Open question — `=` form of `--resume`**: Claude CLI may someday support `--resume=<id>`. The whitespace-tokenizer in `stripResumeContinueFlags` would miss this. *Decision*: accept; update if Claude adds it.
- **Note on `--continue` stripping**: User-supplied `--continue` is stripped from `args`. This means there is no way for a user to invoke Claude's own "continue most recent" heuristic via the args field — Gustav's session-id tracking is the only source of session restoration. Acceptable trade-off given Gustav owns Claude continuity; revisit only if a real use case appears.
