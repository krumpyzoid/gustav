# Plan: Fix macOS session switching and tab rendering

**Created**: 2026-04-09
**Branch**: main
**Status**: implemented

## Goal

Fix two related bugs on macOS: (1) tabs never render and lazygit is always shown, (2) clicking orphaned `$dir` sessions creates new sessions instead of switching to them. Both are caused by `getPtyClientTty()` using the Linux-only `/proc` filesystem.

## Root Cause

`getPtyClientTty()` in `src/main/index.ts:41-48` reads `/proc/${pid}/fd/0` to find the PTY's client TTY path. macOS has no `/proc` filesystem, so this always returns `null`. Consequences:

- `SWITCH_SESSION` returns error immediately (no TTY)
- `START_SESSION` creates sessions but never switches or sets `activeSession`
- Main process `activeSession` stays `null` forever
- Polling returns empty `windows` array
- `TabBar` returns `null` when `windows.length === 0`

Secondary issue: initial session load sets `activeSession` in renderer only, never syncs to main via `switchSession`.

## Acceptance Criteria

- [ ] `getPtyClientTty()` returns a valid TTY path on macOS
- [ ] Clicking a session in the sidebar switches the terminal to it
- [ ] Tab bar renders with correct windows after switching
- [ ] Clicking orphaned `$dir` entries starts and switches to the session
- [ ] Initial app load syncs active session to main process
- [ ] Existing Linux `/proc` path still works
- [ ] All existing tests pass

## Steps

### Step 1: Add `listClients` to TmuxPort and TmuxAdapter

**Complexity**: standard
**RED**: Write test that `TmuxAdapter.listClients()` parses `tmux list-clients` output into `{ tty, pid }` pairs
**GREEN**: Add `listClients()` to `TmuxPort` interface and implement in `TmuxAdapter`
**REFACTOR**: None needed
**Files**: `src/main/ports/tmux.port.ts`, `src/main/adapters/tmux.adapter.ts`, `src/main/adapters/__tests__/tmux.adapter.test.ts`
**Commit**: `feat: add listClients to tmux port for cross-platform TTY discovery`

#### RED: test

```typescript
// In src/main/adapters/__tests__/tmux.adapter.test.ts
it('parses list-clients output into tty/pid pairs', async () => {
  vi.mocked(mockShell.exec).mockResolvedValue(
    '/dev/ttys001 12345\n/dev/ttys002 67890'
  );

  const clients = await adapter.listClients();

  expect(clients).toEqual([
    { tty: '/dev/ttys001', pid: 12345 },
    { tty: '/dev/ttys002', pid: 67890 },
  ]);
  expect(mockShell.exec).toHaveBeenCalledWith(
    "tmux list-clients -F '#{client_tty} #{client_pid}'"
  );
});

it('returns empty array when no clients connected', async () => {
  vi.mocked(mockShell.exec).mockRejectedValue(new Error('no clients'));

  const clients = await adapter.listClients();

  expect(clients).toEqual([]);
});
```

#### GREEN: implementation

```typescript
// In src/main/ports/tmux.port.ts — add to interface:
listClients(): Promise<{ tty: string; pid: number }[]>;

// In src/main/adapters/tmux.adapter.ts — add method:
async listClients(): Promise<{ tty: string; pid: number }[]> {
  const raw = await this.exec("list-clients -F '#{client_tty} #{client_pid}'");
  if (!raw) return [];
  return raw.split('\n').filter(Boolean).map((line) => {
    const spaceIdx = line.lastIndexOf(' ');
    return {
      tty: line.slice(0, spaceIdx),
      pid: Number(line.slice(spaceIdx + 1)),
    };
  });
}
```

### Step 2: Replace `/proc`-based `getPtyClientTty` with cross-platform approach

**Complexity**: standard
**RED**: No unit test for this (it's glue code in `index.ts` using real PTY). Verified by integration in Step 4.
**GREEN**: Rewrite `getPtyClientTty()` to use `tmux list-clients` matching by PID, with `/proc` as fast-path on Linux
**REFACTOR**: None needed
**Files**: `src/main/index.ts`
**Commit**: `fix: cross-platform PTY client TTY discovery using tmux list-clients`

#### Implementation

Replace `getPtyClientTty` in `src/main/index.ts`:

```typescript
// Change from sync to async
async function getPtyClientTty(): Promise<string | null> {
  if (!ptyProcess) return null;

  // Fast path: Linux /proc
  try {
    return fsAdapter.readlink(`/proc/${ptyProcess.pid}/fd/0`);
  } catch {
    // Not on Linux or /proc unavailable — fall through
  }

  // Cross-platform: ask tmux for client TTY matching our PTY pid
  try {
    const clients = await tmuxAdapter.listClients();
    const match = clients.find((c) => c.pid === ptyProcess!.pid);
    return match?.tty ?? clients[0]?.tty ?? null;
  } catch {
    return null;
  }
}
```

Update all callers in `registerHandlers` — change `getPtyClientTty` parameter type from `() => string | null` to `() => Promise<string | null>`.

### Step 3: Update IPC handlers to await async `getPtyClientTty`

**Complexity**: standard
**RED**: No new tests (handler integration is tested via E2E/manual). Existing tests must keep passing.
**GREEN**: Update `handlers.ts` to `await getPtyClientTty()` in `SWITCH_SESSION`, `START_SESSION`, and `CREATE_SESSION`
**REFACTOR**: None needed
**Files**: `src/main/ipc/handlers.ts`, `src/main/index.ts`
**Commit**: `fix: await async getPtyClientTty in IPC handlers`

#### Changes in `handlers.ts`

Update the type of `getPtyClientTty` in the `deps` parameter:

```typescript
getPtyClientTty: () => Promise<string | null>;  // was () => string | null
```

Update each handler that calls it:

```typescript
// SWITCH_SESSION (line 56):
const tty = await getPtyClientTty();

// START_SESSION (line 104):
const tty = await getPtyClientTty();

// CREATE_SESSION (line 79):
const tty = await getPtyClientTty();
```

No other changes needed — the handlers are already async.

### Step 4: Fix initial session load to sync with main process

**Complexity**: standard
**RED**: Write test that verifies `switchSession` is called during initial load when sessions exist
**GREEN**: In `useAppStateSubscription`, call `window.api.switchSession()` after finding first session
**REFACTOR**: None needed
**Files**: `src/renderer/hooks/use-app-state.ts`
**Commit**: `fix: sync initial active session to main process on app load`

#### Implementation

In `use-app-state.ts`, update the initial fetch block:

```typescript
window.api.getState().then(async (state) => {
  setRepos(state.repos);
  setEntries(state.entries);
  setWindows(state.windows ?? []);

  // Set initial active session and sync to main process
  const first = state.entries.find((e) => e.tmuxSession && e.repo !== 'standalone');
  if (first?.tmuxSession) {
    useAppStore.getState().setActiveSession(first.tmuxSession);
    const result = await window.api.switchSession(first.tmuxSession);
    if (result.success) {
      useAppStore.getState().setWindows(result.data);
    }
  }
});
```

### Step 5: Update mock in state.service.test.ts

**Complexity**: trivial
**RED**: Existing tests must still pass after adding `listClients` to mock
**GREEN**: Add `listClients` to `makeMockTmux()` in the test file
**REFACTOR**: None needed
**Files**: `src/main/services/__tests__/state.service.test.ts`
**Commit**: (bundle with Step 1 commit)

#### Implementation

Add to `makeMockTmux()`:

```typescript
listClients: vi.fn().mockResolvedValue([]),
```

### Step 6: Run full test suite and verify

**Complexity**: trivial
**RED**: N/A
**GREEN**: Run `npm test` — all tests must pass
**REFACTOR**: None needed
**Files**: None
**Commit**: N/A (verification only)

## Pre-PR Quality Gate

- [ ] All tests pass
- [ ] Type check passes (`npx tsc --noEmit`)
- [ ] App starts on macOS (`npm run dev`)
- [ ] Session switching works (click session in sidebar, terminal changes)
- [ ] Tab bar renders after session switch
- [ ] Orphaned $dir entry can be started and switched to

## Risks & Open Questions

- **tmux client PID matching**: `ptyProcess.pid` should match `#{client_pid}` since we spawn `tmux attach` directly via node-pty. If tmux forks internally, the PID might differ — the fallback to `clients[0]` handles the single-client case (which is typical for gustav).
- **Race on startup**: `tmux list-clients` may return empty if called before the PTY's `tmux attach` has fully connected. The initial sync in Step 4 runs after `getState()` completes, which should give enough time.
