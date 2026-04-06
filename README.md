# Gustav

A desktop app for managing Git worktrees with integrated tmux sessions. Each worktree gets a tmux session with Claude Code, Lazygit, and a shell — plus any custom windows you define.

Built with Electron, React 19, and xterm.js.

## Prerequisites

- Node.js 18+
- git
- tmux
- lazygit (optional, used in the Git window)

## Setup

```bash
npm install
npm run dev
```

## How It Works

Gustav manages Git worktrees and ties each one to a tmux session. When you create a worktree through the UI, Gustav:

1. Runs `git worktree add` to create the worktree in `.worktrees/<branch>`
2. Copies files, writes `.env`, and runs install commands (all configurable)
3. Launches a tmux session named `<repo>/<branch>` with default windows:
   - **Claude Code** — runs `claude`
   - **Git** — runs `lazygit`
   - **Shell** — plain shell

The embedded terminal (xterm.js + node-pty) attaches to tmux, so you switch between sessions directly in the app. A 5-second polling loop detects Claude Code status (busy/waiting for approval/done) and shows it in the sidebar.

## The `.wt` Config File

Drop a `.wt` file in your repo root to configure worktree behavior. It uses a simple INI format — all sections are optional.

```ini
# Environment variables written to .env in new worktrees
[env]
DATABASE_URL=postgres://localhost/myapp_dev
REDIS_URL=redis://localhost:6379

# Files/directories to copy from repo root into new worktrees
[copy]
config/.env.local
scripts/setup.sh
.claude/settings.local.json

# Command to run after worktree creation (when "Run install" is checked)
[install]
cmd=npm ci && npm run build

# Default base branch for new worktrees
[new]
base=origin/main

# Lifecycle hooks — receive WT_BRANCH and WT_PATH env vars
# pre_ hooks abort on failure, post_ hooks warn and continue
[hooks]
pre_new=echo "Creating $WT_BRANCH"
post_new=npm install
pre_rm=echo "Removing $WT_BRANCH"
post_rm=echo "Done"
pre_clean=git gc
post_clean=echo "Clean complete"

# Extra tmux windows (format: Name:command or just Name)
[tmux]
window=Tests:npm run test:watch
window=Docs:open ./docs/index.html
window=Build

# Branch to check against when finding stale worktrees to clean
[clean]
merged_into=origin/staging
```

### Section Reference

| Section | Purpose |
|---------|---------|
| `[env]` | Key=value pairs written as `.env` in the worktree. If empty, copies root `.env` instead |
| `[copy]` | Relative paths to copy from repo root to worktree |
| `[install]` | `cmd=` shell command to run after setup |
| `[new]` | `base=` default base ref (fallback: `origin/main`) |
| `[hooks]` | `pre_new`, `post_new`, `pre_rm`, `post_rm`, `pre_clean`, `post_clean` |
| `[tmux]` | `window=Name:command` entries — added after the default Claude/Git/Shell windows |
| `[clean]` | `merged_into=` branch for merged-branch detection (default: `origin/staging`) |

### Worktree Lifecycle

**Create** — `.wt` is parsed, then: `git fetch` -> `git worktree add` -> `pre_new` hook -> copy `.claude/settings.local.json` -> write `.env` -> copy `[copy]` files -> run `[install]` -> `post_new` hook -> launch tmux session.

**Remove** — `pre_rm` hook -> `git worktree remove --force` -> kill tmux session -> optionally `git branch -d` -> `post_rm` hook.

**Clean** — finds worktrees where the branch is merged into `merged_into` or the remote branch was deleted. Then: `pre_clean` hook -> remove each worktree + session -> `git worktree prune` -> `post_clean` hook.

## tmux Session Layout

Each worktree session is named `<repo>/<branch>` (e.g. `myapp/feat-auth`). Default windows:

```
Window 0: Claude Code  ->  runs `claude`
Window 1: Git          ->  runs `lazygit`
Window 2: Shell        ->  plain shell
Window 3+: [tmux]      ->  from .wt config
```

Sessions without the `repo/branch` pattern show up as "Standalone" in the sidebar.

## Project Registry

Gustav stores pinned projects in `~/.local/share/wt/repos.json`. Pin a project through the sidebar's `+` button — it recursively discovers git repos in the selected folder. Pinned repos are grouped in the sidebar as Active (has sessions), Idle (no sessions), or Standalone.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Development with HMR |
| `npm run build` | Compile to `out/` |
| `npm run start` | Run the built app |
| `npm run make` | Package for distribution (deb, zip) |
| `npm test` | Run tests |
| `npm run test:watch` | Tests in watch mode |
