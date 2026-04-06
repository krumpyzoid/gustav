# Plan: Fix Claude Status Detection

**Created**: 2026-04-06
**Branch**: main
**Issue**: #4
**Status**: approved

## Goal

Fix the three interconnected bugs in Claude Code status detection: session state leaking across all sidebar entries (caused by `tmux list-panes -a` returning panes from all sessions), slow 5-second polling, and fragile heuristics that can't distinguish idle from done. The fix redesigns detection from a clean foundation — session-scoped pane queries, a simple pattern-based state machine, parallel detection, and no content-diff side effects.

### Detection rules (priority order)

1. No Claude Code pane → `'none'`
2. Pane content is empty / clear → `'idle'`
3. Tail matches `ing...` → `'busy'`
4. Tail matches `ed for` → `'done'`
5. None of the above match → `'action'` (needs input)

## Acceptance Criteria

- [ ] Each session's status is detected independently — no cross-session contamination
- [ ] New `idle` status for clear/empty sessions
- [ ] `action` (needs input) is the default when no other pattern matches
- [ ] `busy` detected by `ing...`, `done` detected by `ed for`
- [ ] Content-diff mechanism fully removed — no `prevPaneContent` cache
- [ ] Polling interval reduced to 2s with parallel per-session detection
- [ ] Claude Code pane is found by window name alone (not `pane_current_command`)
- [ ] All existing tests pass, new tests cover detection logic

## Steps

### Step 1: Fix pane leak — change `-a` to `-s` in `listPanes`

**Complexity**: standard
**RED**: Write a test with two mock sessions (`app/main`, `app/feat`), each with their own `Claude Code` pane showing different content. Assert `detectClaudeStatus('app/main')` reads pane content from `app/main` only — not from `app/feat`.
**GREEN**: In `TmuxAdapter.listPanes()`, replace `-a` with `-s` so tmux scopes results to the target session's windows.
**REFACTOR**: None needed.
**Files**: `src/main/adapters/tmux.adapter.ts`, `src/main/services/__tests__/state.service.test.ts`
**Commit**: `fix: scope listPanes to target session (-a -> -s)`

### Step 2: Drop `cmd === 'claude'` requirement for pane matching

**Complexity**: standard
**RED**: Write a test where the Claude Code pane's `pane_current_command` is `node` (not `claude`). Assert status is still detected (not `'none'`).
**GREEN**: In `detectClaudeStatus`, match panes by `winName === 'Claude Code'` only. Remove the `cmd === 'claude'` check.
**REFACTOR**: None needed.
**Files**: `src/main/services/state.service.ts`, `src/main/services/__tests__/state.service.test.ts`
**Commit**: `fix: match Claude pane by window name only`

### Step 3: Add `idle` status, remove content-diff, redesign detection as pure function

**Complexity**: complex
**RED**: Write tests for the pure `parseClaudeStatus(content: string): ClaudeStatus` function:
  - Empty / whitespace-only content → `'idle'`
  - Tail contains `ing...` (e.g. `✶ Thinking...`, `Reading...`) → `'busy'`
  - Tail contains `ed for` (e.g. `Completed for 2.3s`) → `'done'`
  - Content with text but no `ing...` or `ed for` match → `'action'`
  - No pane found (tested at `detectClaudeStatus` level) → `'none'`
**GREEN**: Add `'idle'` to `ClaudeStatus` union. Create `parseClaudeStatus` as a pure exported function. Rewrite `detectClaudeStatus` to use it. Remove `prevPaneContent` cache and all content-diff logic entirely.
**REFACTOR**: Delete the `prevPaneContent` field from `StateService`. Clean up unused imports.
**Files**: `src/main/domain/types.ts`, `src/main/services/state.service.ts`, `src/main/services/__tests__/state.service.test.ts`
**Commit**: `feat: redesign status detection as pure state machine with idle status`

### Step 4: Parallelize detection and reduce polling interval

**Complexity**: standard
**RED**: Write a test with 3 sessions. Mock `detectClaudeStatus` with a small delay. Assert total `collect()` time is roughly one delay, not three (i.e. calls are concurrent).
**GREEN**: In `collect()`, replace the sequential `for...of` loop over sessions with `Promise.all()`. In `index.ts`, change `startPolling(5000)` to `startPolling(2000)`.
**REFACTOR**: None needed.
**Files**: `src/main/services/state.service.ts`, `src/main/index.ts`, `src/main/services/__tests__/state.service.test.ts`
**Commit**: `perf: parallelize status detection and reduce poll to 2s`

### Step 5: Update renderer for `idle` status

**Complexity**: trivial
**RED**: N/A (UI change, covered by type errors and visual check)
**GREEN**: Update `StatusDot` color map to include `idle` (e.g. dim `bg-c0` or `bg-fg/20`). Update `SessionEntry.statusLabel` — `'idle'` shows no label (same as current `'none'`). Update `statusLabelColors` for `idle`.
**REFACTOR**: None needed.
**Files**: `src/renderer/components/sidebar/StatusDot.tsx`, `src/renderer/components/sidebar/SessionEntry.tsx`
**Commit**: `feat: render idle status in sidebar`

## Pre-PR Quality Gate

- [ ] All tests pass
- [ ] Type check passes (`npx tsc --noEmit`)
- [ ] `/code-review --changed` passes
- [ ] Manual verification: open 2+ sessions, trigger approval in one, confirm only that session turns red

## Risks & Open Questions

- **`action` as default**: Making "needs input" the fallback means any unrecognized Claude output (e.g. a new output format) will show as needing input. This is the safer failure mode — false "needs input" is more useful than false "idle".
- **Poll interval vs system load**: 2s with parallel shell execs (2 per session) could be noticeable with many sessions. Mitigation: monitor and adjust; could add adaptive polling later.
- **Pattern stability**: `ing...` and `ed for` depend on Claude Code's output format. If the format changes, detection breaks. Mitigation: the pure function makes it trivial to update patterns.
