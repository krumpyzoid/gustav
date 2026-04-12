# Plan: Session Restore with Command Replay and Claude Session Tracking

**Created**: 2026-04-12
**Branch**: main
**Status**: implemented

## Goal

When tmux sessions are destroyed (reboot, kill-server, closing terminal), Gustav should restore not just the window structure but also re-execute the correct command in each window — including resuming Claude Code conversations via `claude --resume <session-id>`. This requires extending the persisted session model to store per-window commands and Claude session IDs, then capturing those IDs at runtime via polling.

## Spec Reference

`docs/specs/session-restore.md`

## Acceptance Criteria

- [ ] `PersistedSession.windows` supports both legacy `string[]` and new `WindowSpec[]` formats
- [ ] Restored sessions send the correct command to each window (claude, lazygit, custom commands)
- [ ] Claude windows use `--resume <id>` when a session ID is tracked, `--continue` as fallback
- [ ] Session IDs are captured at runtime by reading `~/.claude/sessions/<pid>.json`
- [ ] IPC handlers persist `WindowSpec[]` (with commands) when creating sessions
- [ ] The poller detects Claude in any pane (not just "Claude Code" windows) and captures its session ID
- [ ] All existing tests continue to pass; new behavior is covered by new tests
- [ ] `workspaces.json` files with old `string[]` format are read without errors

## Steps

### Step 1: Add `WindowSpec` type and `normalizeWindows` helper

**Complexity**: standard
**RED**: Write tests for `normalizeWindows()` — pure function that accepts `(string | WindowSpec)[]` and always returns `WindowSpec[]`. Test: string input → `{ name }`, object passthrough, mixed array, empty array.
**GREEN**: Add `WindowSpec` type to `domain/types.ts`. Add `normalizeWindows()` as a pure function in a new file or in `domain/types.ts`. Update `PersistedSession.windows` type to `(string | WindowSpec)[]` for backward compatibility.
**REFACTOR**: None needed
**Files**: `src/main/domain/types.ts`, `src/main/domain/__tests__/types.test.ts`
**Commit**: `feat: add WindowSpec type and normalizeWindows helper for session restore`

### Step 2: Add `buildRestoreCommand` helper

**Complexity**: standard
**RED**: Write tests for `buildRestoreCommand(spec: WindowSpec): string`. Cases: `{command: 'claude', claudeSessionId: 'abc'}` → `'claude --resume abc'`, `{command: 'claude'}` → `'claude --continue'`, `{command: 'lazygit'}` → `'lazygit'`, `{command: undefined}` → undefined/falsy.
**GREEN**: Implement as a pure function (standalone or static, not tied to a class). Export from `session.service.ts` or `domain/types.ts`.
**REFACTOR**: None needed
**Files**: `src/main/services/session.service.ts`, `src/main/services/__tests__/session.service.test.ts`
**Commit**: `feat: add buildRestoreCommand for claude resume/continue/passthrough logic`

### Step 3: Update `restoreSession()` to send commands

**Complexity**: standard
**RED**: Write tests for `restoreSession()` with `WindowSpec[]` input. Cases:
  - Restoring a directory session sends `claude --continue` to Claude Code, `lazygit` to Git, nothing to Shell
  - Restoring with a `claudeSessionId` sends `claude --resume <id>`
  - Restoring with legacy `string[]` windows sends no commands (backward-compatible)
  - Existing tests still pass (skip if session exists, etc.)
**GREEN**: Update `restoreSession()` to call `normalizeWindows()`, then `sendKeys` with `buildRestoreCommand()` for each window that has a command. Apply session options as before.
**REFACTOR**: None needed
**Files**: `src/main/services/session.service.ts`, `src/main/services/__tests__/session.service.test.ts`
**Commit**: `feat: restoreSession replays window commands on restore`

### Step 4: Update IPC handlers to persist `WindowSpec[]`

**Complexity**: standard
**RED**: The IPC handlers already persist sessions but with `string[]` windows. Write/update tests that verify the handlers now persist `WindowSpec[]` with commands. Test the `PIN_REPOS`, `CREATE_WORKSPACE_SESSION`, `CREATE_REPO_SESSION`, `LAUNCH_WORKTREE_SESSION` handlers persist correct `WindowSpec[]`. For directory sessions: `[{name:'Claude Code', command:'claude'}, {name:'Git', command:'lazygit'}, {name:'Shell'}]`. For workspace sessions: `[{name:'Claude Code', command:'claude'}, {name:'Shell'}]`. For custom `.gustav` windows: include the configured command.
**GREEN**: Update each IPC handler's `workspaceService.persistSession()` call to pass `WindowSpec[]` instead of `string[]`. Extract a helper like `buildWindowSpecs(type, config)` to avoid repetition across handlers.
**REFACTOR**: Extract the duplicated window-building logic across handlers into a shared helper.
**Files**: `src/main/ipc/handlers.ts`
**Commit**: `feat: persist WindowSpec with commands when creating sessions`

### Step 5: Extend `TmuxPort.listPanes` to include pane PID

**Complexity**: standard
**RED**: Write a test for a new `listPanesExtended()` method (or update `listPanes` format) on `TmuxAdapter` that returns `{ paneId, windowName, paneCommand, panePid }[]`. Test parsing of the `|||`-delimited tmux output with the extra field.
**GREEN**: Add `listPanesExtended(session: string)` to `TmuxPort` and `TmuxAdapter`. Format: `#{pane_id}|||#{window_name}|||#{pane_current_command}|||#{pane_pid}`. Parse into typed objects.
**REFACTOR**: None needed. Keep existing `listPanes` to avoid breaking `detectClaudeStatus` in this step.
**Files**: `src/main/ports/tmux.port.ts`, `src/main/adapters/tmux.adapter.ts`, `src/main/adapters/__tests__/tmux.adapter.test.ts`
**Commit**: `feat: add listPanesExtended to TmuxPort for PID-aware pane listing`

### Step 6: Add Claude session ID capture to `StateService`

**Complexity**: complex
**RED**: Write tests for a new `captureClaudeSessionIds()` method on `StateService`. Cases:
  - Discovers Claude PID from pane, reads `~/.claude/sessions/<pid>.json`, returns the session ID
  - Updates `WindowSpec.claudeSessionId` when a new ID is found
  - Also updates `WindowSpec.command` to `'claude'` when Claude is found in a non-Claude window
  - Returns `false` (no changes) when session ID is already captured and unchanged
  - Handles missing session file gracefully (Claude just started, file not yet written)
  - Handles shell PID with no Claude child (Claude exited)
**GREEN**: Implement `captureClaudeSessionIds()` using `listPanesExtended()`, `ShellPort.exec('pgrep -P <pid>')` to find Claude child, and `FileSystemPort.readFile()` to read the session file. Wire into the polling loop — after `collectWorkspaces()`, iterate persisted sessions and call `captureClaudeSessionIds()`. When changes are detected, call `workspaceService.persistSession()`.
**REFACTOR**: Consider whether `StateService` needs `FileSystemPort` and `ShellPort` as new dependencies, or whether a dedicated `ClaudeSessionTracker` service would be cleaner.
**Files**: `src/main/services/state.service.ts`, `src/main/services/__tests__/state.service.test.ts`
**Commit**: `feat: capture Claude session IDs during state polling`

### Step 7: Wire polling capture into the app lifecycle

**Complexity**: trivial
**RED**: N/A — integration wiring, covered by manual testing
**GREEN**: In `index.ts`, pass the additional dependencies (`ShellAdapter`, `FsAdapter`, `WorkspaceService`) to `StateService` if not already available. Ensure the polling loop calls `captureClaudeSessionIds` and persists changes. Verify existing `NEW_WINDOW` and `KILL_WINDOW` handlers also work with the `WindowSpec[]` format (they currently read/write `windows` via `tmux.listWindows` which returns names — these should be updated to preserve `command` and `claudeSessionId` fields when updating persisted sessions).
**REFACTOR**: None needed
**Files**: `src/main/index.ts`, `src/main/ipc/handlers.ts`
**Commit**: `feat: wire Claude session ID capture into app lifecycle`

## Complexity Classification

| Rating | Criteria | Review depth |
|--------|----------|--------------|
| `trivial` | Single-file rename, config change, typo fix, documentation-only | Skip inline review |
| `standard` | New function, test, module, or behavioral change within existing patterns | Spec-compliance + relevant quality agents |
| `complex` | Architectural change, security-sensitive, cross-cutting concern, new abstraction | Full agent suite |

## Pre-PR Quality Gate

- [ ] All tests pass (`pnpm test`)
- [ ] Type check passes (`npx tsc --noEmit`)
- [ ] Linter passes (if configured)
- [ ] Manual test: kill tmux server, reopen Gustav, verify sessions restore with commands
- [ ] Manual test: verify `workspaces.json` backward compatibility (old `string[]` format)
- [ ] Manual test: verify Claude `--resume` works for workspace sessions sharing a directory

## Risks & Open Questions

- **PID resolution reliability**: `pgrep -P <shell_pid>` may not find Claude if the process tree is deeper (e.g. nvm/fnm wrapper). Fallback: scan `~/.claude/sessions/*.json` files for PIDs matching children on the pane's TTY. The spec investigation showed the process is directly under the fish shell, but this should be tested across environments.
- **`StateService` growing too large**: Step 6 adds file I/O and shell exec to what was a tmux-polling service. If this feels wrong during implementation, extract a `ClaudeSessionTracker` service. Decide during step 6 refactor phase.
- **`NEW_WINDOW` / `KILL_WINDOW` handler compatibility**: These handlers currently rebuild the `windows` array from `tmux.listWindows()` (which returns names only). After the migration to `WindowSpec[]`, these handlers will overwrite commands/session IDs with plain names. Step 7 must fix this by merging new window lists with existing `WindowSpec` data.
- **Race condition on capture**: Claude writes its session file on startup. If the poller runs before the file exists, it gets nothing — but the next poll (1s later) will capture it. Acceptable.
