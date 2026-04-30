# Plan: Fix remote-session follow-ups (#16, #17, #18)

**Created**: 2026-04-30
**Branch**: fix/remote-session-followups
**Status**: implemented (steps 1–5; step 6 gated on smoke-test per the staged plan)

## Goal

Resolve three follow-up bugs surfaced after the previous remote-rendering work shipped:

- **#18** — A killed repository session can't be restarted: remote-side click handler has no fallback after wake fails, and the local fallback can silently no-op when its props aren't populated.
- **#17** — `?1;2c` still appears visibly in remote sessions: confirmed remote-side echo (xterm DA1 reply → tmux client → inner shell readline echoes the unmatched tail back through `onPtyData`). Filter at the renderer's input boundary.
- **#16** — Fresh remote-session attach renders blank until the user clicks a window tab: a race between `setActiveTransport` and React's `[activeTransport]` effect re-subscribing to PTY data leaves the new listener un-subscribed for the first few bytes that arrive.

The plan executes in three independent slices (one per issue) so each is shippable on its own. Order is **#18 → #17 → #16** (safest first; #16 may need the most surgery).

## Acceptance Criteria

- [x] Clicking a killed remote repository session creates a fresh session and attaches its PTY (Step 3, tests cover all three tab types and the create-failure path)
- [x] Clicking a killed local session that lacks the props for fresh creation surfaces an actionable error rather than silently doing nothing (Step 2)
- [x] Local and remote click handlers share a single create-call selector — the two paths can no longer drift independently (Step 1, both paths route through `chooseCreateCall`)
- [~] No `?1;2c` (or any DA-shaped reply tail) appears in remote sessions after repeated attaches (Step 4 filter installed; **manual smoke-test required** to confirm against a real remote)
- [x] User input (typed characters, paste) flows through unchanged — DA-reply filter is exact-match-only with anchor regexes, tested against several non-auto-reply CSI sequences (Step 4)
- [~] Fresh remote-session attach renders content immediately without a manual tab click (Step 5; **manual smoke-test required** to confirm. If symptom persists, Step 6 — IPC listener refactor — lands.)
- [x] Tab switching continues to refresh the viewport (no regression on #14 — TabBar's `requestTerminalFit()` still fires after `selectWindow`)
- [x] All existing tests still pass; new tests added for each behavioural change (641 tests passing, +29 new)

## Steps

### Step 1: Extract `chooseCreateCall(tab, props)` helper

**Complexity**: standard
**RED**: Add a unit test for a new pure helper that, given a `SessionTab` plus the props the component receives (`workspaceName`, `workspaceDir`, `repoRoot`), returns either `{ kind: 'workspace', args: […] }`, `{ kind: 'worktree', args: […] }`, `{ kind: 'directory', args: […] }`, or `{ kind: 'unsupported', reason: string }` when the required props are missing for the chosen `tab.type`. Cover all four branches, including the "missing prop" case which today silently no-ops in `handleClickInner`.
**GREEN**: Add `src/renderer/components/sidebar/create-call-selector.ts` exporting `chooseCreateCall`. Pure function — no IPC, no transport.
**REFACTOR**: None needed (it's new).
**Files**: `src/renderer/components/sidebar/create-call-selector.ts` (new), `src/renderer/components/sidebar/__tests__/create-call-selector.test.ts` (new)
**Commit**: `refactor(sidebar): extract create-call selector for killed-session restart`

### Step 2: Wire local `handleClickInner` through the selector

**Complexity**: standard
**RED**: Update an existing local-click test (or add one) to assert that when wake fails on an `inactive` tab and props are populated, the corresponding `window.api.createRepoSession` / `launchWorktreeSession` / `createWorkspaceSession` call fires. Also add: when wake fails AND `tab.type === 'directory'` but `repoRoot` is missing, the click surfaces a recognisable error (e.g. `console.error` with a stable prefix). Today the latter test would fail because the click silently returns.
**GREEN**: Replace the existing conditional ladder in `handleClickInner` with a `chooseCreateCall(tab, props)` call. Dispatch the result via a small `switch` on `kind`. For `kind: 'unsupported'`, log a structured error with the missing-prop reason; do NOT throw. Keep the rest of the flow intact (set active session → switchSession → setActiveTransport).
**REFACTOR**: None — the conditional ladder is fully replaced by the selector.
**Files**: `src/renderer/components/sidebar/SessionTab.tsx`, `src/renderer/components/sidebar/__tests__/SessionTab.test.tsx`
**Commit**: `fix(sidebar): surface missing-prop errors when killed local session clicked (#18)`

### Step 3: Add the same fallback to `handleRemoteClick`

**Complexity**: standard
**RED**: Test in `SessionTab.test.tsx` that an `isInactive` remote tab whose `wakeSession` fails causes the click to invoke the corresponding `remoteTransport.create*Session(...)` based on `tab.type`, then attach the resulting session via `switchSession`. Assert success path: `setActiveTransport` + `setRemoteActiveSession` + `setWindows` all called with the new session. Assert failure path (creation also fails): clean detach, no transport installed.
**GREEN**: In `handleRemoteClick`, after the wake-failure branch, dispatch through `chooseCreateCall(tab, props)` and call the matching method on a fresh `RemoteGustavTransport` instance (or reuse the wake transient if practical). On `kind: 'unsupported'`, log/surface the error and return — same behaviour as the local path. On success, `await switchSession(newId, getTerminalSize())` and install the transport.
**REFACTOR**: If the create-then-switch dance is now duplicated between local and remote paths, extract a tiny `installNewSession(transport, sessionId)` helper. Keep it as a function in `SessionTab.tsx` rather than a separate file unless it grows.
**Files**: `src/renderer/components/sidebar/SessionTab.tsx`, `src/renderer/components/sidebar/__tests__/SessionTab.test.tsx`
**Commit**: `fix(sidebar): create fresh session on remote wake-failure (#18)`

### Step 4: Filter xterm auto-replies at the PTY-input boundary

**Complexity**: standard
**RED**: In `use-terminal.test.tsx`, extend the `#15` regression block: fire the captured `onData` callback with `'\x1b[?1;2c'` (DA1 reply) and assert `transport.sendPtyInput` is NOT called. Then fire it with `'x'` (typed character) and assert `sendPtyInput` IS called. Then fire it with `'\x1b[?6;1R'` (cursor-position-report shape) and assert NOT-called. Cover at minimum: DA1, DA2 (`\x1b[>...c`), DSR cursor-position (`\x1b[...R`).
**GREEN**: Add `src/renderer/lib/terminal/auto-reply-filter.ts` exporting `isXtermAutoReply(data: string): boolean`. Match a small, conservative set of patterns (DA1, DA2, DSR cursor-position) using exact-match regex on the whole string — atomic onData emissions are guaranteed by xterm.js for these replies. Wire the filter into `use-terminal.ts`'s `term.onData` handler: skip forwarding when `isXtermAutoReply(data)` returns true. Document the invariant inline.
**REFACTOR**: Move the inline `#15` invariant comment in `use-terminal.ts` to point at the new helper. Keep the regression test in place — it now covers both the structural fence and the actual filter.
**Files**: `src/renderer/lib/terminal/auto-reply-filter.ts` (new), `src/renderer/lib/terminal/__tests__/auto-reply-filter.test.ts` (new), `src/renderer/hooks/use-terminal.ts`, `src/renderer/hooks/__tests__/use-terminal.test.tsx`
**Commit**: `fix(terminal): filter xterm DA/DSR auto-replies at PTY-input boundary (#17)`

### Step 5: Drive post-attach fit from a `[activeTransport]` effect

**Complexity**: standard
**RED**: In `use-terminal.test.tsx`, add a test: render the hook, then change the mocked `activeTransport` (via the store mock) to a new instance. Assert that `sendPtyResize` is called on the new transport on the next animation frame, *not* on the old one. Also assert it's called exactly once per swap.
**GREEN**: In `useTerminal`, replace the imperative `requestTerminalFit()` calls in `SessionTab.handleRemoteClick` and `TabBar.handleClick` with a hook-side `useEffect(() => { requestTerminalFit(); }, [activeTransport])`. Keep `requestTerminalFit` as the public API for future explicit refits, but the hook now self-fits on every transport flip — call sites no longer race React. Remove the manual `requestTerminalFit()` from `SessionTab` and `TabBar`.
**REFACTOR**: Update the JSDoc on `requestTerminalFit` to note that the hook auto-fits on transport change; the export is for *additional* fits (e.g. after `selectWindow`, where the transport doesn't change but the view does).
**Files**: `src/renderer/hooks/use-terminal.ts`, `src/renderer/hooks/__tests__/use-terminal.test.tsx`, `src/renderer/components/sidebar/SessionTab.tsx`, `src/renderer/components/terminal/TabBar.tsx`
**Commit**: `fix(terminal): auto-fit on transport change so first attach renders (#16)`

### Step 6: Close the IPC-listener gap during transport swap

**Complexity**: complex
**RED**: Test that PTY data arriving on the IPC channel between the time the old `RemoteGustavTransport.detach()` runs and the new `RemoteGustavTransport`'s `onPtyData(...)` listener subscribes is still delivered to the new listener. Easiest expression: in a vitest test against the preload-bridge mock, simulate `window.api.onRemotePtyData` being subscribed-then-unsubscribed-then-subscribed again, with bytes pushed in the gap, and assert the bytes arrive at the second subscriber.
**GREEN**: Pick *one* of:
- (a) Make the IPC-bridge listener for `'remote-pty-data'` permanent — installed once at app boot in the preload script. The renderer-side `onRemotePtyData` API becomes a fan-out registration against an in-memory subject. Transports subscribe/unsubscribe against the subject without touching IPC. Bytes arriving while no transport is subscribed are dropped *only* if no subject subscriber exists, but a swap is fan-out (not IPC-level), so there's no gap.
- (b) Keep the per-subscribe IPC bridge but add a small replay buffer (last ~200 ms of bytes) so a fresh subscriber gets back-fill. Risk: duplicate writes if any byte was already delivered to the previous subscriber.
Recommend (a) — it's cleaner and removes a class of races permanently. Implement in the preload script and the renderer-side `window.api.onRemotePtyData` adapter.
**REFACTOR**: Once the bridge holds a single permanent listener, `RemoteGustavTransport.onPtyData` becomes purely an in-memory register/unregister. Remove any leftover IPC-level subscribe/unsubscribe code in the transport. Add inline doc explaining why.
**Files**: `src/preload/index.ts` (or wherever the renderer IPC bridge lives), `src/renderer/lib/transport/remote-transport.ts`, related tests
**Commit**: `fix(remote): single permanent IPC listener avoids data drop on transport swap (#16)`

## Complexity Classification

Each step's complexity rating drives review depth during `/build`.

| Rating | Criteria | Review depth |
|--------|----------|--------------|
| `trivial` | Single-file rename, config change, typo fix, documentation-only | Skip inline review; covered by final `/code-review --changed` |
| `standard` | New function, test, module, or behavioural change within existing patterns | Spec-compliance + relevant quality agents |
| `complex` | Architectural change, security-sensitive, cross-cutting concern, new abstraction | Full agent suite including opus-tier agents |

## Pre-PR Quality Gate

- [ ] All tests pass (`npm test` / `vitest run`)
- [ ] Type check passes (`tsc --noEmit` across `tsconfig.main.json`, `tsconfig.preload.json`, `tsconfig.renderer.json`)
- [ ] Linter passes (if a script exists)
- [ ] `/code-review --changed` passes
- [ ] Manual verification: build the app, attach a remote session — content appears without a manual tab click; no `?1;2c` artefacts after 10+ attaches; killed remote and local repository sessions can be restarted by clicking the tab

## Decisions (locked in)

- **Staged Step 6.** Steps 1–5 ship first; smoke-test against a real remote. Step 6 only lands if the symptom persists after Step 5.
- **Step 6 architecture choice deferred.** Option (a) vs (b) is decided when/if Step 6 is needed.
- **Step 4 regex strategy confirmed.** Exact-match-only on the whole `data` string; xterm.js emits DA/DSR replies as atomic single-call onData events.
- **Step 3 remote worktree shape confirmed.** `RemoteGustavTransport.createRepoSession(workspaceName, repoRoot, 'worktree', branch, base)` is the correct call.

## Risks & Open Questions

- **Step 4 false-positive matches.** If the auto-reply regex is too permissive, real user input that happens to match a DA-shaped sequence (paste of escape-laden content) would be swallowed silently. Mitigation per the locked-in decision above: exact-match-only on the whole `data` string.

- **Step 6 testing (if reached).** The preload script runs in a different environment from the renderer; mocking the IPC bridge faithfully in vitest is brittle. Consider testing the renderer-side fan-out independently of the actual `electron.contextBridge` wiring. Risk: a contract-level test that passes against a mock but breaks against the real bridge.

- **Plan Branch field.** Set to `main` per the previous plan's pattern; this branch will be created during `/build`. Suggested naming: `fix/remote-session-followups`.
