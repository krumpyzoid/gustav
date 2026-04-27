# Spec: Tab Kind Decoupling (Slice A)

## 1. Intent Description

Today, `buildRestoreCommand()` in `src/main/services/session.service.ts:9-18` decides "this is a Claude tab" by exact-match on `spec.command === 'claude'`. Any flag (`claude --dangerously-skip-permissions`) makes the check miss, the command is replayed verbatim on wake, and `--resume <id>` is never appended — so the user loses Claude session continuity.

This slice promotes "Claude-ness" from a string-match on the literal command to an explicit `kind` field on `WindowSpec`. The literal command/args become independent of the resume logic, and slices B and C can let users author Claude tabs with arbitrary flags safely.

Composition rule for Claude tabs:

- If a `claudeSessionId` is tracked → `claude [user args without --resume/--continue] --resume <id>`
- If no `claudeSessionId` is tracked → `claude [user args without --resume/--continue]` (bare claude, no `--continue` added)

User-supplied `--resume X` and `--continue` in the `args` field are stripped: Gustav owns Claude session continuity via its tracked session id. Users own everything else (model, perms, etc.).

This is the foundational slice. It contains no UI changes, no IPC changes, and no preload changes — only domain types, session service, and snapshot logic.

## 2. User-Facing Behavior (Gherkin)

```gherkin
Feature: Claude tabs resume regardless of CLI flags

  Scenario: Vanilla Claude tab uses --resume on wake
    Given a tab of kind "claude" with no extra args
    And the tab has claudeSessionId "abc123"
    When the session is woken from sleep
    Then the tab is started with "claude --resume abc123"

  Scenario: Claude tab without prior session is bare claude
    Given a tab of kind "claude" with no claudeSessionId
    When the session is woken
    Then the tab is started with "claude"

  Scenario: Claude tab with extra flags resumes the previous session
    Given a tab of kind "claude" with args "--dangerously-skip-permissions"
    And the tab has claudeSessionId "abc123"
    When the session is woken from sleep
    Then the tab is started with "claude --dangerously-skip-permissions --resume abc123"

  Scenario: Claude tab with extra flags and no prior session
    Given a tab of kind "claude" with args "--dangerously-skip-permissions"
    And no claudeSessionId
    When the session is woken
    Then the tab is started with "claude --dangerously-skip-permissions"

  Scenario: User-supplied --resume in args is stripped and replaced
    Given a tab of kind "claude" with args "--resume bogus --foo"
    And the tab has claudeSessionId "abc123"
    When the session is woken
    Then the tab is started with "claude --foo --resume abc123"
    And no duplicate --resume tokens are present

  Scenario: User-supplied --continue in args is stripped
    Given a tab of kind "claude" with args "--continue"
    And the tab has claudeSessionId "abc123"
    When the session is woken
    Then the tab is started with "claude --resume abc123"

  Scenario: User-supplied --continue with no claudeSessionId is dropped
    Given a tab of kind "claude" with args "--continue"
    And no claudeSessionId
    When the session is woken
    Then the tab is started with "claude"

  Scenario: Non-Claude command tab restores its captured command unchanged
    Given a tab of kind "command" with command "npm run dev"
    When the session is woken
    Then the tab is started with "npm run dev"

  Scenario: Empty command on a command tab opens a shell at cwd
    Given a tab of kind "command" with no command
    When the session is woken
    Then a shell is opened at the tab's directory
    And no command is sent to the shell

  Scenario: Pre-A persisted sessions are discarded on first start
    Given workspaces.json contains sessions persisted by a pre-A version (no "kind" field on windows)
    When the app starts
    Then those sessions are removed from the persisted list
    And the user starts new sessions normally
    And other workspaces continue to load
```

## 3. Architecture Specification

### Domain types (`src/main/domain/types.ts`)

```ts
type WindowSpec = {
  name: string;
  kind: 'claude' | 'command';      // required (after step 6)
  command?: string;                 // kind: 'command'; empty/undefined = shell at cwd
  args?: string;                    // kind: 'claude'; freeform claude flags
  claudeSessionId?: string;         // kind: 'claude'
  directory?: string;
};
```

- `normalizeWindows()` is removed.
- `PersistedSession.windows` becomes `WindowSpec[]` (no union with `string`).
- New exported guard `isValidWindowSpec(w: unknown): w is WindowSpec` requires `kind` to be set.

### Pure helpers (new file: `src/main/domain/claude-command.ts`)

- `stripResumeContinueFlags(args: string): string` — whitespace-token parser; removes any `--resume` (and the following token if present) and any `--continue` token. `=` form not supported (documented limitation).
- `composeClaudeCommand(spec: { args?: string; claudeSessionId?: string }): string`:
  - Strip `args` via `stripResumeContinueFlags`.
  - Compose: `claude` + (cleaned args, if any) + (`--resume <id>`, if `claudeSessionId` set).
  - No `--continue` is ever added.

### Restore composition (`src/main/services/session.service.ts`)

- `buildRestoreCommand(spec)`:
  - If `spec.kind === 'claude'` (or back-compat `spec.command === 'claude'` with no kind): delegate to `composeClaudeCommand`.
  - If `spec.kind === 'command'` or unset: return `spec.command || undefined`. `undefined` means no `send-keys`; tmux opens an empty shell.
- The four `launch*Session` methods stop hardcoding the Claude command template literal. Each builds the implicit `WindowSpec` for the Claude tab (kind: 'claude', args: undefined) and routes through `composeClaudeCommand` — single source of truth.

### Snapshot (`src/main/ipc/snapshot-windows.ts`)

- Drop the `if (existing?.command === 'claude')` early branch; replace with `kind === 'claude'`.
- For windows with an existing spec: preserve `kind`, `args`, `claudeSessionId`.
- For new windows (no existing spec):
  - If `resolveChildCommand` returns a command whose first whitespace-token is `claude`: emit `{ kind: 'claude', args: stripResumeContinueFlags(remainder) }`. No `command` field.
  - Otherwise: emit `{ kind: 'command', command: childCmd ?? undefined }`. Shells at prompt fall through with no command.

### Persisted-session filtering (`src/main/services/workspace.service.ts`)

- On JSON load: for each `PersistedSession`, validate every `windows[i]` via `isValidWindowSpec`. If any window is invalid, drop the entire session from the workspace (logged with `tmuxSession` name). Other workspaces and other sessions in the same workspace are unaffected. No JSON rewrite — the next persist pass naturally overwrites.

### Out of scope

- No new IPC channels.
- No preload changes.
- No renderer changes (apart from `WindowSpec` type updates picked up via TypeScript).
- No data migration of pre-A `workspaces.json` content (pre-A sessions are filtered out, not transformed).

## 4. Acceptance Criteria

| # | Criterion | Verification |
|---|---|---|
| A1 | Claude tabs with arbitrary flags resume via `--resume <id>` after sleep/wake when a `claudeSessionId` is tracked. | `composeClaudeCommand` unit tests covering all Claude scenarios. Manual smoke: sleep+wake a session with `--dangerously-skip-permissions` set, verify the woken process has both flags via `ps`. |
| A2 | When no `claudeSessionId` is tracked, the Claude tab launches as bare `claude` (plus any user args) — no `--continue`. | Unit test asserts `composeClaudeCommand({ kind: 'claude' })` returns `'claude'` and `composeClaudeCommand({ kind: 'claude', args: '--foo' })` returns `'claude --foo'`. |
| A3 | User-supplied `--resume X` or `--continue` in `args` is stripped. | Unit test asserts `stripResumeContinueFlags('--resume bogus --continue --foo')` returns `'--foo'`. |
| A4 | A `kind: 'command'` tab with no `command` opens an empty shell at the tab's `directory`. | Unit test asserts `buildRestoreCommand({ kind: 'command' })` returns `undefined`. Existing Shell-tab integration tests still pass. |
| A5 | Pre-A persisted sessions are silently dropped at app start; remaining workspaces load cleanly. | Unit test loads a fixture with mixed valid and pre-A sessions, asserts only valid ones survive, no throw. |
| A6 | All four `launch*Session` methods route Claude-tab command construction through `composeClaudeCommand`. | Code review + grep: no remaining `\`claude --resume \${...}\`` template literals outside the helper. |
| A7 | Slice A introduces no new IPC channels, no preload changes, no renderer-visible behavior change for non-Claude tabs. | Diff review: `src/preload/`, `src/renderer/` untouched (except for `WindowSpec` type imports). |
| A8 | `normalizeWindows` and the `(string \| WindowSpec)[]` union are removed. | grep returns only test-fixture references and the deletion commit. |
| A9 | No regressions on existing snapshot/restore tests; existing tests updated to use `kind` explicitly. | CI green. |

## 5. Consistency Gate

- [x] Intent unambiguous — two devs would build the same shape.
- [x] Every behavior in the intent has a Gherkin scenario.
- [x] Architecture constrains to what intent requires (no premature flag UI, no per-flag toggles).
- [x] `kind`, `args`, `claudeSessionId` named consistently across all four artifacts.
- [x] No artifact contradicts another. A5 ("drop pre-A sessions") is intentionally lossy per the user's decision.

**Gate: PASS.** Implementation plan: `plans/tab-kind-decoupling.md`.
