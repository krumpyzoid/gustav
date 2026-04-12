# Session Restore Spec

## Problem

When the tmux server dies (e.g. `tmux kill-server`, macOS reboot, closing the last terminal emulator), all tmux sessions are destroyed. Gustav can recreate the session *structure* (windows with correct names) via `restoreSession()`, but:

1. **Window commands are not re-executed.** The "Claude Code" window gets an empty shell instead of `claude --continue`. The "Git" window gets an empty shell instead of `lazygit`. Custom `.gustav` windows (e.g. `Dev:pnpm run dev`) are not restarted.
2. **Claude sessions lose continuity.** Even if `claude` is relaunched, it starts a fresh conversation instead of resuming the previous one.

## Current Behavior

### What Gustav already does on app start (`index.ts:213`)

```
await sessionService.restoreAll(workspaceService.list());
```

This iterates every persisted session from `workspaces.json` and calls `restoreSession()`, which:

1. Checks if the tmux session already exists (skip if so)
2. Creates the tmux session with the first window name
3. Applies session options (status off, prefix None, mouse on)
4. Creates remaining windows by name
5. Selects the first window

**What it does NOT do:** send any commands to the restored windows.

### What Gustav does on session *creation* (`session.service.ts`)

When Gustav creates a *new* session (e.g. `launchDirectorySession`), it:

1. Creates the tmux session with "Claude Code" window
2. **Sends `claude` to the Claude Code window**
3. Creates "Git" window, **sends `lazygit`**
4. Creates "Shell" window (no command)
5. Adds custom windows from `.gustav` config, **sends their commands**

### The gap

`restoreSession()` only recreates the window structure. It does not know *what command each window should run*. The information about commands exists at two levels:

- **Convention:** Claude Code window → `claude`, Git window → `lazygit`
- **Configuration:** `.gustav` `[tmux]` section → `window=Name:command`

Neither is persisted in `workspaces.json` or used during restore.

## Desired Behavior

### After tmux server restart (reboot, kill-server, etc.)

When Gustav starts and finds persisted sessions missing from tmux:

1. Recreate the tmux session structure (already works)
2. **Re-execute the correct command in each window:**
   - "Claude Code" → `claude --resume <session-id>` (resumes the exact conversation)
   - "Git" → `lazygit`
   - "Shell" → no command (just a shell)
   - Custom `.gustav` windows → their configured command

### Claude session continuity

There are two categories of sessions with different restore strategies:

**Directory/Worktree sessions** — one Claude instance per unique cwd. `claude --continue` (resumes most recent conversation scoped to cwd) would work here *in theory*, but for consistency and reliability we track session IDs for all session types.

**Workspace/Standalone sessions** — multiple sessions can share the same directory (the workspace root). `claude --continue` would resume the wrong conversation. **Must use `claude --resume <session-id>`.**

### How to capture the Claude session ID

Claude stores active session metadata at `~/.claude/sessions/<pid>.json`:

```json
{
  "pid": 98949,
  "sessionId": "35761075-7783-48e1-b73a-392eaf7eae7b",
  "cwd": "/Users/mathias/Documents/hivy/dev/honeycomb",
  "startedAt": 1775924890733,
  "kind": "interactive",
  "entrypoint": "cli"
}
```

The Claude PID can be discovered from tmux:

```bash
# Get the shell PID for each pane
tmux list-panes -t 'session:window' -F '#{pane_pid}'
# Find the claude child process
ps -o pid,comm -p $(pgrep -P <shell_pid>) | grep claude
# OR use the TTY approach
tmux list-panes -t 'session:window' -F '#{pane_tty}'
ps -t <tty> -o pid,comm | grep claude
```

Then read `~/.claude/sessions/<claude_pid>.json` to get the `sessionId`.

**Timing:** Gustav should capture the session ID *after* Claude has started (the file is written at startup). This can be done:
- During state polling (every 1s) — `StateService` already walks panes to detect Claude status
- As a one-shot check shortly after session launch

### Capture strategy: periodic sync during state polling

`StateService.detectClaudeStatus()` already iterates all panes and checks `pane_current_command === 'claude'`. Extend this to also read `pane_pid` → find Claude child PID → read `~/.claude/sessions/<pid>.json` → extract `sessionId`. When a new session ID is discovered for a window, persist it to `workspaces.json`.

This piggybacks on existing infrastructure and handles the case where Claude restarts within a pane.

## Design

### Approach: Persist window commands + Claude session IDs in `PersistedSession`

Extend the `PersistedSession` type:

```typescript
// Current
type PersistedSession = {
  tmuxSession: string;
  type: SessionType;
  directory: string;
  windows: string[];
};

// Proposed
type WindowSpec = {
  name: string;
  command?: string;          // command to send-keys on restore (undefined = no command)
  claudeSessionId?: string;  // tracked Claude session UUID (only for Claude Code windows)
};

type PersistedSession = {
  tmuxSession: string;
  type: SessionType;
  directory: string;
  windows: WindowSpec[]; // BREAKING: was string[]
};
```

### Migration

`windows` changes from `string[]` to `WindowSpec[]`. Handle both formats during read:

```typescript
// In restoreSession or a migration step
const specs: WindowSpec[] = session.windows.map((w) =>
  typeof w === 'string' ? { name: w } : w
);
```

### Persist commands at session creation time

When `launchDirectorySession`, `launchWorktreeSession`, `launchWorkspaceSession`, or `launchStandaloneSession` creates a session, also persist it to `workspaces.json` with the window commands:

**Directory/Worktree session windows:**

| Window         | Command             | claudeSessionId |
|----------------|---------------------|-----------------|
| Claude Code    | `claude`            | *(captured later by polling)* |
| Git            | `lazygit`           | — |
| Shell          | *(none)*            | — |
| Custom (`.gustav`) | configured command | — |

**Workspace session windows:**

| Window         | Command             | claudeSessionId |
|----------------|---------------------|-----------------|
| Claude Code    | `claude`            | *(captured later by polling)* |
| Shell          | *(none)*            | — |
| Custom (`.gustav`) | configured command | — |

**Standalone session windows:**

| Window         | Command             | claudeSessionId |
|----------------|---------------------|-----------------|
| Claude Code    | `claude`            | *(captured later by polling)* |
| Shell          | *(none)*            | — |

### Claude session ID capture (polling)

The capture must be **window-name-agnostic**. The user might start Claude manually in any pane (Shell, custom window, etc.), not just the "Claude Code" window. Gustav should track the session ID for *any* pane running `claude`, keyed by window name.

`StateService.detectClaudeStatus()` already iterates all panes via `tmux list-panes -s -F '#{pane_id}|||#{window_name}|||#{pane_current_command}'`. Extend this to also extract the pane PID when `pane_current_command === 'claude'`:

```typescript
// Extend the list-panes format to include pane_pid
tmux list-panes -t '<session>' -s -F '#{pane_id}|||#{window_name}|||#{pane_current_command}|||#{pane_pid}'
```

For each pane running `claude`:
1. Get the shell PID (`pane_pid`)
2. Find the Claude child process: `ps -o pid,comm` of children of that shell PID, or scan `~/.claude/sessions/*.json` for a file whose PID is a child of `pane_pid`
3. Read `~/.claude/sessions/<claude_pid>.json` → extract `sessionId`
4. Match to the `WindowSpec` by window name, update `claudeSessionId` if changed
5. Persist to `workspaces.json` when any ID changes

```typescript
private async captureClaudeSessionIds(
  tmuxSession: string,
  windows: WindowSpec[],
): Promise<boolean> {
  let changed = false;
  const panes = await this.tmux.listPanesExtended(tmuxSession);
  // panes: { windowName, paneCommand, panePid }[]

  for (const pane of panes) {
    if (pane.paneCommand !== 'claude') continue;

    // Find the window spec for this pane
    const spec = windows.find((w) => w.name === pane.windowName);
    if (!spec) continue;

    // Resolve Claude PID (child of the shell in this pane)
    const claudePid = await this.resolveClaudePid(pane.panePid);
    if (!claudePid) continue;

    // Read the session file
    const sessionFile = join(homedir(), '.claude', 'sessions', `${claudePid}.json`);
    try {
      const data = JSON.parse(await readFile(sessionFile, 'utf-8'));
      if (data.sessionId && data.sessionId !== spec.claudeSessionId) {
        spec.claudeSessionId = data.sessionId;
        changed = true;
      }
    } catch {}
  }

  return changed;
}
```

This runs during the existing 1s polling loop. It captures session IDs regardless of whether Gustav launched Claude or the user started it manually. When a new session ID is discovered, the updated `PersistedSession` is persisted to `workspaces.json`.

**Important:** If a window that was originally "Shell" now has Claude running in it, the spec's `command` should also be updated to `'claude'` so it gets properly restored with `--resume` on next restart.

### Restore with commands + session resume

Update `restoreSession()` to send commands after creating windows:

```typescript
async restoreSession(session: PersistedSession): Promise<void> {
  if (await this.tmux.hasSession(session.tmuxSession)) return;

  const specs = normalizeWindows(session.windows);
  const [first, ...rest] = specs;
  if (!first) return;

  await this.tmux.newSession(session.tmuxSession, {
    windowName: first.name,
    cwd: session.directory,
  });
  // Apply session options...
  if (first.command) {
    await this.tmux.sendKeys(
      `${session.tmuxSession}:${first.name}`,
      this.buildRestoreCommand(first),
    );
  }

  for (const spec of rest) {
    await this.tmux.newWindow(session.tmuxSession, spec.name, session.directory);
    if (spec.command) {
      await this.tmux.sendKeys(
        `${session.tmuxSession}:${spec.name}`,
        this.buildRestoreCommand(spec),
      );
    }
  }

  await this.tmux.selectWindow(session.tmuxSession, first.name);
}

/** Build the actual command to send, substituting claude resume flags. */
private buildRestoreCommand(spec: WindowSpec): string {
  if (spec.command === 'claude' && spec.claudeSessionId) {
    return `claude --resume ${spec.claudeSessionId}`;
  }
  if (spec.command === 'claude' && !spec.claudeSessionId) {
    return 'claude --continue';
  }
  return spec.command!;
}
```

**Priority order for Claude windows:**
1. `claude --resume <session-id>` — if we have a tracked session ID (most reliable)
2. `claude --continue` — fallback if session ID was never captured (e.g. session created but Claude was never started, or first-time launch)

### When to persist

**Window structure + commands:** at session creation time. The `SessionService.launch*` methods should return the `WindowSpec[]` so the caller (IPC handler) can call `workspaceService.persistSession()`.

**Claude session IDs:** during state polling, whenever a new ID is discovered.

This keeps `SessionService` focused on tmux operations while persistence logic stays in the IPC/state layer.

### Edge cases

**`claude --resume` with an expired/invalid session ID:** Claude shows an error message and offers to start a new session. The user can manually proceed. This is acceptable.

**Claude not yet started when polling runs:** The `claudeSessionId` field stays `undefined`. On restore, falls back to `claude --continue`.

**lazygit not installed:** Window shows "command not found". Same behavior as today.

**First launch (no prior Claude session):** `claude --continue` gracefully starts a new session. `claudeSessionId` is `undefined` until polling captures it.

**User starts Claude manually:** If the user types `claude` in a "Shell" or custom window, the poller detects it (pane_current_command === 'claude'), captures the session ID, and updates both `command` and `claudeSessionId` on the matching `WindowSpec`. On restore, that window will resume the Claude session instead of opening a bare shell.

**Multiple Claude panes in one session:** Each window has its own `WindowSpec` with its own `claudeSessionId`. The poller matches by window name, so multiple Claude instances in different windows are tracked independently.

## Out of Scope

- **Saving/restoring terminal scrollback** — tmux-resurrect territory, not needed here
- **Restoring window layout/splits** — Gustav only manages named windows, not pane layouts
- **Persisting running process state** (e.g. dev server) — the process is gone; we only re-run the command

## Tasks

1. **Extend `PersistedSession` type** — add `WindowSpec` with `command` and `claudeSessionId`, update `domain/types.ts`
2. **Add migration** — handle `string[]` → `WindowSpec[]` in reads
3. **Update `restoreSession()`** — send commands after creating windows, with `--resume` / `--continue` logic
4. **Persist sessions at creation time** — return `WindowSpec[]` from launch methods, persist in IPC handlers
5. **Add Claude session ID capture to `StateService`** — read `~/.claude/sessions/<pid>.json` during polling, persist to `workspaces.json` when new IDs are found
6. **Update tests** — cover restore-with-commands, session ID capture, migration, `buildRestoreCommand` logic, and new persistence flow
