# Plan: Fix Remote Sessions — Tab Regression, Wake Failure, Create UI

**Created**: 2026-04-30
**Branch**: `fix/remote-sessions`
**Status**: implemented

## Goal

Resolve three GitHub issues that together prevent remote-host usage from reaching feature parity with local. (1) Stop the 1Hz local state poll from clobbering window-tab state owned by the remote transport (#10). (2) Make the remote command dispatcher and PTY manager backend-aware so wake/sleep/destroy/window operations and PTY attach work for native-supervisor sessions, and stop the renderer from silently attaching after a failed wake (#11). (3) Expose new-workspace, new-worktree, and new-standalone session creation from the remote sidebar by extending `SessionTransport` and threading transport selection into the existing dialogs, plus implement the server-side worktree branch (#12).

Spec reference: `specs/remote-control.md` (remote-control invariants — TLS, single-client, shared local+remote access). The fixes here uphold those invariants without changing them.

## Acceptance Criteria

- [x] Clicking a window tab on a live remote session leaves the active-tab indicator on the clicked tab indefinitely (no revert after the next state poll). _Pinned by `use-app-state.test.ts`._
- [x] Switching between two live remote sessions shows each session's own tabs in the header. _Pinned by `use-app-state.test.ts`._
- [x] Clicking an inactive remote session in the sidebar wakes the session on the remote host and the terminal attaches successfully — for both `tmux` and `native` backends. _Pinned by `command-dispatcher.test.ts` + `pty-manager.test.ts`._
- [x] When a remote wake fails, the user sees a clear error path (logged + state refresh), not `[lost tty]` in the terminal. _Pinned by `SessionTab.test.tsx`._
- [x] Remote `wake-session`, `sleep-session`, `destroy-session`, `select-window`, `new-window`, `kill-window`, `list-windows` work for native-supervisor-backed sessions on the remote host. _Pinned by `command-dispatcher.test.ts` backend dispatch suite._
- [x] User can create a new workspace session, worktree session, and standalone session on a connected remote host through the existing dialogs reached from the remote sidebar. _Pinned by `dialog-transport.test.tsx` + `RemoteSection.test.tsx`._
- [x] Remote `create-repo-session` with `mode: 'worktree'` creates the git worktree on the remote and launches a session at that path. _Pinned by `command-dispatcher.test.ts` worktree tests._
- [x] Local behavior (no remote connected) is unchanged across all flows. _All 493 pre-existing tests still pass._
- [x] All new tests pass; existing tests still pass. _531 tests pass (up from 493)._

## Steps

### Step 1: Preserve `windows` slice when active transport is remote (#10)

**Complexity**: standard
**RED**: In `src/renderer/hooks/__tests__/use-app-state.test.ts` (extend or create), add three tests:
- with `LocalTransport` active, `setFromState` updates the `windows` slice from the grouped state;
- with `RemoteGustavTransport` active and a non-empty `windows` slice already set by a remote `switchSession`, `setFromState` does **not** overwrite `windows`;
- after switching from remote session A (windows=[a1,a2]) to remote session B (windows=[b1,b2,b3]) with an interleaved `setFromState({windows: []})`, the store's windows match B's.

**GREEN**: In `src/renderer/hooks/use-app-state.ts:65-72`, branch `setFromState` on `get().activeTransport.kind`. When `'remote'`, set workspaces/sessions but omit the `windows` field. Add a one-line comment explaining ownership (transport owns windows when remote; local poller owns them otherwise).
**REFACTOR**: None needed.
**Files**: `src/renderer/hooks/use-app-state.ts`, `src/renderer/hooks/__tests__/use-app-state.test.ts`
**Commit**: `fix(renderer): preserve windows slice when active transport is remote`

### Step 2: Plumb supervisor, sessionLauncher, worktreeService into remote dispatcher

**Complexity**: standard
**RED**: In `src/main/remote/__tests__/command-dispatcher.test.ts`, add a test that constructs `CommandDispatcher` with the new deps (using fakes) and asserts existing handlers still resolve correctly — this pins the constructor surface before behavior changes land.

**GREEN**: Extend `DispatcherDeps` in `src/main/remote/command-dispatcher.ts` with `supervisor: SessionSupervisorPort`, `sessionLauncher: SessionLauncherService`, `worktreeService: WorktreeService`. Extend `RemoteServiceDeps` in `src/main/remote/remote.service.ts` with the same; pass them through to the new `CommandDispatcher`. Wire them in `src/main/index.ts` where `RemoteService` is instantiated. No handler logic changes yet.
**REFACTOR**: None needed.
**Files**: `src/main/remote/command-dispatcher.ts`, `src/main/remote/remote.service.ts`, `src/main/index.ts`, `src/main/remote/__tests__/command-dispatcher.test.ts`
**Commit**: `refactor(remote): plumb supervisor/sessionLauncher/worktreeService into command dispatcher`

### Step 3: Backend-aware lifecycle and window dispatch

**Complexity**: complex (cross-cutting; mirrors strangler pattern from local IPC)
**RED**: In `command-dispatcher.test.ts`, add tests covering each handler with a persisted `backend: 'native'` session and a fake supervisor:
- `wake-session` calls `supervisor.wakeSession` if `hasSession`, else `supervisor.createSession({sessionId, cwd, windows})`; returns supervisor windows.
- `sleep-session` calls `supervisor.sleepSession` (and only if `hasSession`).
- `destroy-session` calls `supervisor.killSession` and removes the persisted session.
- `select-window`, `new-window`, `kill-window` route to supervisor.
- `list-windows` returns supervisor windows for native-backed sessions.
- For each, the mirrored `tmux` path is unchanged.

**GREEN**: In `src/main/remote/command-dispatcher.ts`, port the local dispatch logic from `src/main/ipc/handlers.ts:300-393`:
- Add private `backendOf(sessionId)` reusing `workspaceService.findPersistedBackend`.
- Add private `supervisorWindowsAsInfo(sessionId)` mirroring `handlers.ts:100-110`.
- Branch each lifecycle/window case on `backendOf(session)`; route native to `supervisor.*`, leave existing tmux path intact.
- For `list-windows`, use the helper for native; existing `applyPersistedWindowOrder` path for tmux.

**REFACTOR**: After all branches land, extract the common `findPersisted(session) → {ws, persisted} | null` lookup if duplication is meaningful.
**Files**: `src/main/remote/command-dispatcher.ts`, `src/main/remote/__tests__/command-dispatcher.test.ts`
**Commit**: `fix(remote): backend-aware wake/sleep/destroy/window dispatch`

### Step 4: Backend-aware PTY attach over WebSocket

**Complexity**: complex (new abstraction in PtyManager; security-adjacent — must validate session)
**RED**: New file `src/main/remote/__tests__/pty-manager.test.ts`:
- Constructing `PtyManager` with a fake supervisor and calling `attachSupervisor(sessionId, cols, rows)` returns a channel id; `supervisor.attachClient` is called once; data emitted by `supervisor.onWindowData` is encoded into `ChannelType.PTY_DATA` frames passed to `onFrame`; `handleInput` for that channel routes into `supervisor.sendInput`; `detach` calls `supervisor.detachClient` and unsubscribes.
- Existing tmux attach path keeps working (do not regress).

**GREEN**: In `src/main/remote/pty-manager.ts`:
- Make `PtyEntry` a tagged union (`{kind: 'tmux'; ptyProcess; tmuxSession}` | `{kind: 'native'; sessionId; clientId; off}`).
- Add optional `supervisor` constructor param.
- Implement `attachSupervisor` per the test contract; rewrite `handleInput`, `resize`, `detach`, `destroyAll` to branch on `kind`.

In `src/main/remote/remote.service.ts:296-336`:
- Construct `PtyManager` once with the supervisor injected.
- In `handleAttachPty`, look up `findPersistedBackend(session) ?? 'tmux'`. For native sessions, call `attachSupervisor` instead of `attach`.
- `handleResizePty` / `handleDetachPty` already proxy to `PtyManager`; no change once polymorphic.
- Keep existing `isKnownSession` validation gate.

**REFACTOR**: None needed yet — keep the two attach paths visibly distinct in PtyManager.
**Files**: `src/main/remote/pty-manager.ts`, `src/main/remote/remote.service.ts`, `src/main/remote/__tests__/pty-manager.test.ts`
**Commit**: `feat(remote): native-supervisor PTY attach over WebSocket`

### Step 5: Abort remote attach when wake fails (#11)

**Complexity**: standard
**RED**: Extend `src/renderer/components/sidebar/__tests__/SessionTab.test.tsx` — a click on an inactive remote session whose `wakeSession` returns `{success: false, error: '…'}` does NOT subsequently call `switchSession`/`attach-pty`, and triggers `refreshState`. (Mock `RemoteGustavTransport`.)

**GREEN**: In `src/renderer/components/sidebar/SessionTab.tsx:122-141`, capture the wake result and early-return on failure with `console.error` + `refreshState()`.
**REFACTOR**: None needed.
**Files**: `src/renderer/components/sidebar/SessionTab.tsx`, `src/renderer/components/sidebar/__tests__/SessionTab.test.tsx`
**Commit**: `fix(renderer): abort attach when remote wake fails`

### Step 6: Add session-creation methods to `SessionTransport`

**Complexity**: standard
**RED**: In `src/renderer/lib/transport/__tests__/local-transport.test.ts` and `remote-transport.test.ts` (extend or create):
- `createWorkspaceSession(name, dir, label?)` calls the right underlying API (`window.api.createWorkspaceSession` for local; `remoteSessionCommand('create-workspace-session', {workspaceName, workspaceDir, label})` for remote) and returns the `Result<string>`.
- Same shape for `createStandaloneSession(label, dir)` and `createRepoSession(name, repoRoot, mode, branch?, base?)`.
- `getBranches(repoRoot)` calls `window.api.getBranches` for local and `remoteSessionCommand('get-branches', {repoRoot})` for remote.

**GREEN**: Extend the `SessionTransport` interface in `src/renderer/lib/transport/session-transport.ts` with the four methods (typed `Promise<Result<string>>` for the three creators, `Promise<BranchInfo[]>` for `getBranches`). Implement on `LocalTransport` (delegate to `window.api`) and `RemoteGustavTransport` (delegate via `remoteSessionCommand`). For `getBranches` on remote, unwrap the `Result` envelope to match the local return type or change the local return to a `Result` too — pick whichever minimises caller churn (likely keep returning `BranchInfo[]` and treat remote failures as empty lists with a `console.error`).
**REFACTOR**: None needed.
**Files**: `src/renderer/lib/transport/session-transport.ts`, `src/renderer/lib/transport/local-transport.ts`, `src/renderer/lib/transport/remote-transport.ts`, `src/renderer/lib/transport/__tests__/local-transport.test.ts`, `src/renderer/lib/transport/__tests__/remote-transport.test.ts`
**Commit**: `feat(transport): expose session-creation methods on SessionTransport`

### Step 7: Thread `transport` prop through creation dialogs

**Complexity**: standard
**RED**: For each dialog, add a renderer test:
- `src/renderer/components/dialogs/__tests__/NewSessionDialog.test.tsx`: rendering with a fake `transport` prop and submitting calls `transport.createWorkspaceSession` (not `window.api`).
- Same shape for `NewStandaloneDialog` and `NewWorktreeDialog`.
- `NewWorktreeDialog` test also asserts `transport.getBranches` is called instead of `window.api.getBranches`.
- A regression test asserts that without a `transport` prop the dialog defaults to a `LocalTransport` (legacy behavior preserved).

**GREEN**: Add an optional `transport?: SessionTransport` prop to each dialog (default to `new LocalTransport()`). Replace direct `window.api.create*` and `getBranches` calls with `transport.*`. For `NewStandaloneDialog`, hide the local "Browse" button when `transport.kind === 'remote'` (manual path entry; remote directory picker is a follow-up).
**REFACTOR**: None needed.
**Files**: `src/renderer/components/dialogs/NewSessionDialog.tsx`, `NewStandaloneDialog.tsx`, `NewWorktreeDialog.tsx`, plus matching test files.
**Commit**: `feat(dialogs): route session creation through SessionTransport prop`

### Step 8: Implement server-side worktree creation in remote dispatcher (#12)

**Complexity**: standard
**RED**: In `command-dispatcher.test.ts`, add a test for `create-repo-session` with `mode: 'worktree'`:
- Calls `worktreeService.create({repo, repoRoot, branch, base})` with `base` defaulting to repo-config or `'origin/main'`.
- Calls `sessionLauncher.launch(sessionName, sessionDir, windows)` where `sessionDir = git.getWorktreeDir(repoRoot)/branch`.
- Persists the session with `type: 'worktree'`, `branch`, `repoRoot`, and the launched `backend`.
- Returns `ok(sessionId)`.
- Returns `err('Branch name required …')` when branch is missing.

**GREEN**: Replace the stub at `src/main/remote/command-dispatcher.ts:175-199` with an implementation mirroring `src/main/ipc/handlers.ts:445-486`. Use `buildWindowSpecs`, `repoConfigService`, and the freshly-plumbed `worktreeService` + `sessionLauncher` from step 2.
**REFACTOR**: If duplication with the local handler grows, extract a shared `launchRepoSession` helper — only do this if it fits naturally in one file.
**Files**: `src/main/remote/command-dispatcher.ts`, `src/main/remote/__tests__/command-dispatcher.test.ts`
**Commit**: `feat(remote): server-side git worktree creation in dispatcher`

### Step 9: Wire remote sidebar create affordances (#12)

**Complexity**: standard
**RED**: In `src/renderer/components/sidebar/__tests__/RemoteSection.test.tsx` (extend or create):
- Rendering with a connected remote workspace exposes a "+" affordance on each remote workspace accordion that, when clicked → "Create new session", invokes the `onNewSession` callback with the workspace's `(name, directory)`.
- "+ → Pin repositories" / "Add worktree" affordances surface for remote (or are explicitly excluded with a TODO comment if out of scope this round).
- Smoke test in `App.test.tsx` (if it exists) — invoking the remote `onNewSession` opens the `NewSessionDialog` with `transport.kind === 'remote'`.

**GREEN**:
- `RemoteSection.tsx`: accept `onNewSession`, `onNewStandalone`, `onAddWorktree` props; thread them into the `WorkspaceAccordion` invocations (which already render the dropdown when callbacks are present).
- `Sidebar.tsx`: add corresponding props and forward them to `RemoteSection`.
- `App.tsx`: introduce dialog state for the remote target — when remote callbacks fire, open the same dialog passing `transport={new RemoteGustavTransport()}` (or a stable instance).

**REFACTOR**: After UI lands, evaluate whether a small `useDialogTarget()` hook would simplify the App-level wiring. Only if it pays for itself.
**Files**: `src/renderer/components/sidebar/RemoteSection.tsx`, `Sidebar.tsx`, `src/renderer/App.tsx`, `src/renderer/components/sidebar/__tests__/RemoteSection.test.tsx`
**Commit**: `feat(ui): wire create-new affordances in remote sidebar`

## Complexity Classification

| Step | Rating |
|------|--------|
| 1 | standard |
| 2 | standard |
| 3 | complex (cross-cutting strangler) |
| 4 | complex (new abstraction; security-adjacent) |
| 5 | standard |
| 6 | standard |
| 7 | standard |
| 8 | standard |
| 9 | standard |

## Pre-PR Quality Gate

- [ ] `npm run test` passes
- [ ] `tsc -p tsconfig.main.json` and `tsc -p tsconfig.renderer.json` (or `electron-vite build`) compile cleanly
- [ ] No new linter warnings
- [ ] `/code-review --changed` passes
- [ ] Manual smoke (two-instance Electron flow):
  - [ ] Tab indicator stays on the clicked window tab on remote sessions
  - [ ] Switching between two remote sessions shows each session's own tabs
  - [ ] Wake an inactive remote session of both backends; terminal attaches
  - [ ] Failed wake shows error path, not `[lost tty]`
  - [ ] Create remote workspace, worktree, standalone sessions through the sidebar `+` menu
- [ ] Documentation updated only if behavior diverges from `specs/remote-control.md` (no expected divergence; only spec-aligned coverage adds)

## Risks & Open Questions

- **Risk — supervisor PTY framing on remote**: native-supervisor data is currently consumed locally via the `supervisor:on-data` IPC channel that includes `{sessionId, windowId, data}`. When forwarding over the WebSocket we drop the `windowId` and treat the active window as authoritative. This matches how `tmux attach` works (the active window is what the user sees), but it means scrollback/inactive-window updates aren't streamed. *Mitigation*: scope to active-window data in step 4; revisit if users need remote multi-pane visibility.
- **Risk — replay on attach for native sessions**: `getReplay` exists on the supervisor; should we send buffered scrollback on attach so the remote terminal isn't blank? *Mitigation*: send `getReplay(sessionId, activeWindowId)` once on `attachSupervisor` if available, otherwise skip. Decide during step 4 implementation.
- **Risk — directory picker on remote standalone**: browsing remote directories requires a remote dialog channel we don't have. *Mitigation*: accept manual path entry for remote in step 7; defer remote directory-listing to a follow-up issue.
- **Open question — `getBranches` return type uniformity**: local returns `BranchInfo[]`, remote command returns `Result<BranchInfo[]>`. Choose: (a) add `Result` envelope locally, (b) unwrap remote with empty-list fallback. *Default*: (b) — minimal caller churn — decide during step 6.
- **Open question — supervisor windowId vs `WindowInfo.index`**: the supervisor uses string ids; the renderer uses numeric indices. Mirror the local synthesis logic (`supervisorWindowsAsInfo`) verbatim; revisit if/when local converges to string ids.
