# Plan: Fix worktree SSH auth and remote-session rendering

**Created**: 2026-04-30
**Branch**: main
**Status**: implemented

## Goal

Resolve three triaged bugs filed as GitHub issues #13, #14, #15:

- **#13** — Worktree creation fails when the new branch needs `git fetch origin`, because the SSH agent socket isn't reaching the spawned git process and ssh falls through to a missing `ssh-askpass`.
- **#14** — Remote sessions attach with hardcoded `cols: 80, rows: 24` and never run `fit()` after attach or after `selectWindow`, so content needs an OS-window resize to render at the right geometry.
- **#15** — Visible `?1;2c` characters in remote terminals — the printable tail of an ANSI DA1 reply leaking into the inner shell, likely a downstream effect of #14's dimension-race.

The plan executes in three independent slices (one per issue) so each is shippable on its own.

## Acceptance Criteria

- [~] Creating a worktree against an SSH-only remote succeeds when the user has a working ssh-agent — *requires manual verification against a real SSH remote (steps 1–3 land the agent-env contract + structured error + startup warning; the actual launch-context fix may need an env import step depending on what the warning surfaces)*
- [x] When the agent is genuinely unreachable, the user sees a structured, actionable error (not raw ssh stderr) — `WorktreeService.create` now rethrows a classified `Error` with `code: 'SSH_AGENT_UNAVAILABLE'` and an actionable message
- [x] `RemoteGustavTransport.switchSession` no longer hardcodes `80, 24` — it attaches at the renderer's actual viewport size (Step 4 + SessionTab call site)
- [x] Switching window tabs inside a remote session repaints without a manual OS-window resize (Step 6: `requestTerminalFit()` after `selectWindow`)
- [~] Repeated remote attaches do not leak `?1;2c` (or any other DA-shaped reply tail) into the visible buffer — *renderer-side invariant pinned by regression test (step 7); manual verification needed to confirm symptom is gone in practice*
- [x] All existing tests still pass; new tests added for each behavioural change (603 tests passing, +24 new)
- [x] No regression in local sessions, in the remote env-minimisation policy (`pty-manager.attachTmux`), or in xterm.js scrollback / font state across transport swaps (`pty-manager.ts` untouched; full suite green)

## Steps

### Step 1: Pin shell-adapter env-inheritance contract

**Complexity**: standard
**RED**: Add a vitest unit test for `ShellAdapter.execFile` (and `exec`) that asserts:
- when `opts` is omitted, the child sees `process.env` (use `process.execPath` running a `-e "console.log(process.env.<KEY>)"` and a sentinel value set on `process.env` before the call);
- when `opts.env` is provided, the child sees `process.env` overlayed by `opts.env` (overlay wins, ambient remains);
- when `opts.env` is provided, the child still sees ambient vars *not* listed in the overlay.
**GREEN**: In `src/main/adapters/shell.adapter.ts`, replace `env: opts?.env ? { ...process.env, ...opts.env } : undefined` with `env: { ...process.env, ...opts?.env }` for both `exec` and `execFile`. Behaviour-equivalent today (Node treats `env: undefined` as inherit), but the contract is now explicit and hard to break by future "minimal env" overlays.
**REFACTOR**: None needed.
**Files**: `src/main/adapters/shell.adapter.ts`, `src/main/adapters/__tests__/shell.adapter.test.ts` (new)
**Commit**: `fix(shell): make env inheritance explicit in shell adapter`

### Step 2: Classify ssh-auth failures from `git fetch` into a structured error

**Complexity**: standard
**RED**: Test `WorktreeService.create` against a mocked `GitPort.fetch` that rejects with the askpass / `Permission denied (publickey,password)` signature. Assert the error surfaced to the caller has `code: 'SSH_AGENT_UNAVAILABLE'` (or equivalent) and a human message that mentions ssh-agent, not raw stderr. Add a positive test: an unrelated fetch failure (e.g. network) keeps its original message.
**GREEN**: Add a small `classifyGitFetchError(err)` helper (e.g. in `src/main/services/worktree.service.ts` or a sibling util). Wrap `await this.git.fetch(repoRoot)` so the recognised signature gets rethrown as a structured `Error` with `code` and a user-friendly message. Other errors pass through.
**REFACTOR**: If a sibling helper file is created, ensure it is not coupled to `WorktreeService` so future call sites (e.g. clean / prune) can use it.
**Files**: `src/main/services/worktree.service.ts`, `src/main/services/__tests__/worktree.service.test.ts`, optional new `src/main/services/git-error-classifier.ts` + tests
**Commit**: `fix(worktree): classify ssh-agent-unavailable git fetch errors`

### Step 3: Surface SSH-env diagnostics at startup

**Complexity**: trivial
**RED**: Add a unit test for a small `checkSshEnv({ env })` helper that returns a `{ ok: false, missing: ['SSH_AUTH_SOCK'] }` shape when the var is missing, and `{ ok: true }` when present. Test that the formatter produces the expected one-line warning string.
**GREEN**: Implement `checkSshEnv` and call it once during main-process startup (next to where the supervisor / remote services are wired up). Log a single `console.warn` if missing. Do not throw — many users don't need git-over-ssh.
**REFACTOR**: None needed.
**Files**: `src/main/index.ts`, new `src/main/util/check-ssh-env.ts` + tests
**Commit**: `chore(main): warn at startup when SSH_AUTH_SOCK is unavailable`

### Step 4: Pass live cols/rows on remote attach

**Complexity**: standard
**RED**: Update `RemoteGustavTransport`'s test to assert that `switchSession(session, { cols, rows })` (or whichever shape we land on — see below) forwards the caller-provided `cols`/`rows` to `remoteSessionCommand(AttachPty, …)`. Today's test pins `80, 24`; rewrite that assertion against a concrete non-default size.
**GREEN**: Pick one of:
- (a) Extend `SessionTransport.switchSession` to accept an optional `{ cols, rows }`. `LocalTransport` ignores them; `RemoteGustavTransport` forwards them to attach.
- (b) Add a `setInitialSize(cols, rows)` setter on `RemoteGustavTransport` called by the renderer right before `switchSession`.
- (c) Have `RemoteGustavTransport` lazy-read live size from a small getter passed at construction (mirrors `LocalTransport`'s `ActiveSessionGetter`).
Recommend (a) — it's the most discoverable from the call site, matches existing transport methods, and the local no-op cost is zero. Update both call sites (`SessionTab.handleRemoteClick`, anywhere else `switchSession` is awaited) to pass `term.cols, term.rows` from the renderer's terminal hook.
**REFACTOR**: Add a one-line code comment on the new param explaining why local can ignore it.
**Files**: `src/renderer/lib/transport/session-transport.ts`, `src/renderer/lib/transport/remote-transport.ts`, `src/renderer/lib/transport/local-transport.ts`, `src/renderer/components/sidebar/SessionTab.tsx`, `src/renderer/hooks/use-terminal.ts` (or wherever cols/rows are read), tests for all three transport files
**Commit**: `fix(remote): attach PTY at the renderer's live size, not 80x24`

### Step 5: Fit terminal after `switchSession` resolves

**Complexity**: standard
**RED**: Add a test for whatever helper coordinates the post-switch fit. Two paths:
- If we add a tiny `requestFit()` API on the terminal hook (e.g. via a ref or a small store signal), test that calling it triggers `fitAddon.fit()` exactly once on next `requestAnimationFrame` and forwards the resulting cols/rows to `currentTransport().sendPtyResize`.
- Alternatively, test in `SessionTab.tsx` (renderer integration): after `await remoteTransport.switchSession(...)` resolves, we observe a call to the fit signal.
**GREEN**: Wire the call: in the renderer flow that calls `switchSession`, after success, schedule one `fit()` on `requestAnimationFrame`. The existing `fit()` already calls `sendPtyResize`, so dimensions catch up.
**REFACTOR**: If both `switchSession` and `selectWindow` end up needing this, extract a shared `requestTerminalFit()` invocation to avoid repetition. Don't pre-extract — wait until step 6 confirms the duplication.
**Files**: `src/renderer/hooks/use-terminal.ts` (export a fit-trigger ref), `src/renderer/components/sidebar/SessionTab.tsx` (or wherever switch is awaited), accompanying tests
**Commit**: `fix(remote): fit terminal after switchSession to sync PTY dims`

### Step 6: Fit terminal after `selectWindow` resolves

**Complexity**: standard
**RED**: In `TabBar.test.tsx`, add a test that asserts: clicking a window tab (a) calls `activeTransport.selectWindow`, (b) once that resolves, triggers the fit-signal exposed by step 5.
**GREEN**: In `TabBar.handleClick`, after `await activeTransport.selectWindow(...)` resolves, call the fit-trigger. Order matters — must happen before `focusTerminal()`.
**REFACTOR**: If steps 5 and 6 use the same shape (likely yes), inline-document the invariant once near the trigger's definition: "any time the active *view* changes — session swap or window swap — call this so the PTY's dims and xterm.js's geometry agree".
**Files**: `src/renderer/components/terminal/TabBar.tsx`, `src/renderer/components/terminal/__tests__/TabBar.test.tsx`
**Commit**: `fix(remote): fit terminal after selectWindow so tabs repaint`

### Step 7: Verify `?1;2c` is gone; if not, fix the root cause

**Complexity**: complex
**RED**: Add a renderer integration test that simulates a remote attach where the remote PTY immediately writes a `\x1b[c` (DA1 query). Assert two invariants:
1. The DA1 reply (`\x1b[?1;2c`) emitted by xterm.js is delivered to `transport.sendPtyInput` (not to `term.write`).
2. After a transport swap (remote→local→remote), no buffered/late reply ends up in `term.write` of the new transport. The simulation must include the case where the swap happens *between* xterm.js receiving the query and emitting the reply.
**GREEN**: Run the test with steps 4–6 already merged. If both invariants hold, the bug should be gone (it was a downstream effect of #14). If a test fails, the most likely fix is on transport swap to cancel any outstanding xterm.js parser state that expects a reply consumer (e.g. by clearing pending response handlers, or by deferring transport rebind until the next animation frame so xterm.js has flushed its current parse). Implement the minimal fix that makes both invariants hold.
**REFACTOR**: Add a comment near `term.onData` in `use-terminal.ts` documenting the invariant: "responses from xterm.js MUST always reach `transport.sendPtyInput` and MUST NOT be delivered into `term.write`. Transport swaps must not split a query/response across transports." This is the kind of rule that is silently broken by future edits.
**Files**: `src/renderer/hooks/use-terminal.ts`, possibly `src/renderer/lib/transport/remote-transport.ts`, accompanying tests (likely a new `src/renderer/hooks/__tests__/use-terminal.test.ts` since none exists today)
**Commit**: `fix(remote): prevent DA1 reply leak across transport swaps`

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
- [ ] Linter passes
- [ ] `/code-review --changed` passes
- [ ] Manual verification: smoke-test worktree creation against a real SSH remote
- [ ] Manual verification: attach a remote session, confirm content renders without OS-window resize and no `?1;2c` artefacts appear after 10+ attaches

## Risks & Open Questions

- **Step 1 hypothesis vs. true root cause for #13.** The most likely real cause is that `process.env.SSH_AUTH_SOCK` simply isn't set in the Electron main process (depends on launch context — Hyprland/Walker may not propagate user-shell env). Step 1's explicit `env` spread is defence-in-depth, not necessarily the fix. If the user's process.env genuinely lacks the var, the fix path is environment plumbing at app launch — options to consider during step 3 if the warning fires:
  - Run `systemctl --user import-environment SSH_AUTH_SOCK` from the user's session (out of Gustav's scope; document in README)
  - Use a small `shell-env`/`fix-path`-style import on first launch to read the user's interactive shell env (cross-platform caveats; adds startup latency)
  - Document that Gustav must be launched from a shell that has the agent exported
  Pick after the warning provides evidence of which user environments are affected. Open question for the user: which option do you prefer if step 3 confirms missing env?

- **Transport API shape (Step 4 (a)/(b)/(c)).** Choice (a) extends the port. Trade-off: small breaking change to a port interface, but most explicit and easiest to test. Worth confirming you're OK with the port signature change before implementing.

- **Existing `local-transport.ts:111-112` also hardcodes `cols: 80, rows: 24`** in the supervisor's `attachClient` call. That path is best-effort; resizes follow via `ResizeObserver`. Tempting to fix in the same step, but it's a different code path (supervisor, not remote PTY) and not a user-visible bug — leave alone unless step 4's port change makes it natural to fix.

- **Test infrastructure for `use-terminal.ts` doesn't exist** (no `__tests__` for this hook). Step 7 requires creating it. Risk: setting up xterm.js in jsdom can be flaky. Mitigation: mock xterm.js at the module boundary and assert behaviour through observable side effects (calls to `term.write`, `transport.sendPtyInput`). Don't try to render xterm.js in the test environment.

- **Step 7 is the riskiest** — its fix is contingent on what we actually observe after steps 4–6. The plan reflects this with an explicit "verify, then fix only if needed" structure. Worst case: the bug persists with a different root cause, in which case step 7 expands to a deeper investigation. Open question: are you OK landing steps 1–6 as separate PRs and re-evaluating step 7 against the running app?
