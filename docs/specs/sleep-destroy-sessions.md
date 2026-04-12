# Spec: Sleep / Destroy Session Semantics

## 1. Intent Description

Gustav currently has a single "kill" action for sessions. With the session restore feature, killing a session now preserves the persisted entry (including `claudeSessionId`) so it can be resumed. But the user has no way to permanently remove a session they no longer want.

This spec introduces two distinct session lifecycle actions:

- **Sleep** (was "kill") — stops the tmux session but keeps the persisted entry. The session remains visible in the sidebar as inactive and can be woken up with a click. Claude resumes via `--resume <id>`.
- **Destroy** — stops the tmux session AND removes the persisted entry. The session disappears from the sidebar entirely. The Claude conversation is abandoned.

Sleeping sessions must remain visible in the sidebar so the user can see what's paused and wake them up.

## 2. User-Facing Behavior (Gherkin)

```gherkin
Feature: Sleep and Destroy sessions

  Background:
    Given Gustav is running with a workspace "dev" containing a pinned repo "api"
    And a directory session "dev/api/_dir" is active with Claude session ID "uuid-1"

  # ── Sleep ────────────────────────────────────────────────────────

  Scenario: Sleeping a session stops tmux but keeps it visible
    When the user clicks the sleep button on "dev/api/_dir"
    Then the tmux session "dev/api/_dir" is killed
    And the persisted session entry is kept in workspaces.json
    And the session appears in the sidebar as sleeping (inactive, with Moon icon)
    And clicking the sleeping session wakes it with "claude --resume uuid-1"

  Scenario: Sleeping sessions survive app restart
    Given the session "dev/api/_dir" is sleeping
    When Gustav restarts
    Then the session is restored via restoreAll with "claude --resume uuid-1"

  Scenario: Sleeping a workspace session
    Given a workspace session "dev/Cocorico" is active with Claude session ID "uuid-2"
    When the user clicks the sleep button on "dev/Cocorico"
    Then the tmux session is killed
    And the session appears in the sidebar as sleeping
    And clicking it wakes it with "claude --resume uuid-2"

  # ── Destroy ──────────────────────────────────────────────────────

  Scenario: Destroying a session removes it completely
    When the user clicks the destroy button on "dev/api/_dir"
    Then the tmux session "dev/api/_dir" is killed
    And the persisted session entry is removed from workspaces.json
    And the session disappears from the sidebar
    But the pinned repo "api" still shows an inactive directory entry (can be launched fresh)

  Scenario: Destroying a workspace session removes it
    Given a workspace session "dev/debug" is active
    When the user clicks the destroy button on "dev/debug"
    Then the tmux session is killed
    And the persisted entry is removed
    And the session disappears from the sidebar entirely

  Scenario: Destroying a sleeping session
    Given the session "dev/api/_dir" is sleeping
    When the user clicks the destroy button on the sleeping entry
    Then the persisted session entry is removed from workspaces.json
    And the session is replaced by a launchable inactive directory entry (no Moon icon, just a dim entry)

  # ── Sidebar display ─────────────────────────────────────────────

  Scenario: Sleeping sessions are visually distinct from active ones
    Given "dev/api/_dir" is sleeping
    And "dev/api/feat-auth" is active
    Then "dev/api/_dir" shows with Moon icon and reduced opacity
    And "dev/api/feat-auth" shows with normal icons and full opacity

  Scenario: Sleeping workspace sessions appear in workspace session list
    Given workspace session "dev/Cocorico" is sleeping
    Then it appears in the workspace's session list with Moon icon
    And clicking it wakes it (launches and resumes Claude)
```

## 3. Architecture Notes

### Current state

- `KILL_SESSION` IPC handler: kills tmux, keeps persisted entry (from the resume fix)
- `SessionTab.tsx`: shows a single `✕` button on active sessions, no button on inactive
- `StateService.collectWorkspaces()`: builds session list from live tmux sessions + persisted entries for pinned repos. Workspace-type sleeping sessions are NOT shown because they only appear if there's a live tmux session.

### Key gap: sleeping workspace/standalone sessions are invisible

Currently, `collectWorkspaces()` discovers sessions from two sources:
1. **Live tmux sessions** → `active: true`
2. **Pinned repo placeholders** → `active: false` (directory sessions for repos without a tmux session, orphan worktrees)

Sleeping workspace sessions (e.g. `dev/Cocorico`) don't appear because:
- They're not in tmux (killed)
- They're not tied to a pinned repo
- The persisted sessions in `workspaces.json` aren't surfaced to the state model

### Design: Surface persisted sessions as sleeping entries

After building session tabs from live tmux sessions, merge in persisted sessions that are NOT in tmux. These become sleeping entries (`active: false`, `status: 'none'`).

```
For each workspace:
  For each persisted session in ws.sessions:
    If tmux session exists → already in sessionTabs (active: true)
    If tmux session does NOT exist → add as sleeping entry (active: false)
```

This covers all session types (workspace, directory, worktree) uniformly.

### IPC changes

| Channel | Current behavior | New behavior |
|---------|-----------------|--------------|
| `KILL_SESSION` | Kill tmux, keep persisted entry | **Rename to `SLEEP_SESSION`**. Same behavior. |
| *(new)* `DESTROY_SESSION` | — | Kill tmux (if running) + remove persisted entry |

### UI changes

| Element | Current | New |
|---------|---------|-----|
| Active session `✕` button | Calls `killSession` | **Becomes sleep button** (Moon icon, warning/yellow color). Calls `sleepSession`. |
| *(new)* Destroy button | — | Trash icon (destructive/red), shown on hover for both active AND sleeping sessions. Calls `destroySession`. |
| Sleeping session display | Only shown for pinned repo placeholders | Shown for ALL persisted sessions without a tmux session |

### Naming convention

- API: `sleepSession` / `destroySession`
- IPC channels: `SLEEP_SESSION` / `DESTROY_SESSION`
- UI labels: "Put to sleep" / "Destroy session"

## 4. Acceptance Criteria

- [ ] Clicking the sleep button (Moon icon) on an active session kills the tmux session but keeps the persisted entry
- [ ] Sleeping sessions appear in the sidebar with Moon icon and reduced opacity
- [ ] Sleeping workspace/standalone sessions are visible (not just pinned-repo sessions)
- [ ] Clicking a sleeping session wakes it and resumes Claude via `--resume <id>`
- [ ] Clicking the destroy button (Trash icon) kills the tmux session AND removes the persisted entry
- [ ] Destroying a sleeping session removes it from the sidebar
- [ ] The destroy button is available on both active and sleeping sessions
- [ ] App restart restores sleeping sessions via `restoreAll()`
- [ ] Old `killSession` API is replaced with `sleepSession` / `destroySession`
- [ ] All existing tests pass; new IPC handlers are tested
