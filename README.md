# Gustav

A desktop app for managing your development sessions. Each project gets a tmux session with Claude Code, Lazygit, and a shell — and you can control everything from the sidebar while Claude's status updates in real time across all your sessions.

Connect remotely over Tailscale to operate your workstation from anywhere.

<img width="4098" height="2574" alt="image" src="https://github.com/user-attachments/assets/738acaea-f9d1-48b6-8302-c21f10174723" />

## Getting Started

```bash
npm install
npx electron-vite dev
```

Or just ask Claude to build the app :) There are instructions for macOS and Arch Linux.

Requires Node.js 18+, git, tmux, and lazygit.

## Workspaces

A workspace is a project folder. When you create one, Gustav discovers the git repos inside it and lets you pin the ones you work on.

Each pinned repo appears in the sidebar with its sessions underneath. You can drag to reorder workspaces, repos, and sessions.

**To create a workspace:** Click `+` in the top bar > New Workspace > pick a directory.

**To pin repos:** Click the pin icon on a workspace > select repos from the list.

## Sessions

Click any session in the sidebar to switch to it. The terminal attaches instantly.

| Type | What it's for |
|------|---------------|
| **Directory** | Work on a repo's main branch. Opens with Claude Code, Lazygit, and a shell. |
| **Worktree** | Work on a feature branch in an isolated copy. Same windows as directory. |
| **Workspace** | General tasks at the workspace level. Claude Code and a shell. |
| **Standalone** | Quick session in any folder. |

### Sleep & Wake

Put a session to sleep when you're not using it — it frees the tmux session but remembers everything: window layout, Claude session IDs, running commands. Wake it later and it restores exactly where you left off.

**Sleep All** (moon icon in the top bar) pauses every active session.

### Worktrees

Create a worktree from the sidebar: pick a branch (or create one), choose a base ref, and Gustav handles the git commands, file copying, and environment setup. The new worktree gets its own session immediately.

**Cleaning up:** Gustav detects worktrees where the branch was merged or the remote was deleted. Batch-clean them from Settings.

## Claude Code

Every session starts with a Claude Code window. Gustav tracks Claude's status across all sessions and shows it in the sidebar:

- **Spinning** — Claude is working
- **Orange dot** — Claude needs your approval
- **Green dot** — Claude is done

When you wake a session, Gustav resumes your Claude conversation automatically.

## Terminal

The embedded terminal attaches directly to tmux. Keyboard shortcuts:

| Shortcut | Action |
|----------|--------|
| **Ctrl + / -** | Zoom in/out (terminal and sidebar scale together) |
| **Ctrl + 0** | Reset zoom |
| **Alt + Up/Down** | Switch between sessions |
| **Alt + Left/Right** | Switch between windows in the current session |

Text you select is automatically copied to your clipboard. Mouse scroll works for tmux scrollback.

### Window Tabs

Each session has named tabs above the terminal (Claude Code, Git, Shell, plus any custom ones from your config). Click to switch, and you can add or remove windows on the fly.

## Remote Control

Access your desktop's Gustav from your laptop over the internet. Pair once, then reconnect with one click.

### First Time Setup

**On your desktop:**
1. Go to Settings > Remote Host
2. Click "Enable Remote Access"
3. Copy the connection string (looks like `100.64.0.1:7777:ABC123`)

**On your laptop:**
1. Click the wifi icon in the sidebar
2. Paste the connection string
3. Done — remote workspaces appear in the sidebar

The connection is saved automatically. Next time, just click your desktop in the saved servers list.

### What You Can Do Remotely

- See all your workspaces and sessions with live Claude status
- Click a remote session to attach — the terminal streams in real time
- Create, sleep, wake, and destroy remote sessions
- Forward dev server ports: if something runs on `localhost:5173` on your desktop, forward it so your laptop can access it too

### Network

Designed for Tailscale (free tier works). Both machines get stable IPs and can reach each other directly — no port forwarding needed.

## Themes

Six built-in themes: System, Gruvbox Dark, Gruvbox Light, Nord, Rose Pine, and Claude. Change in Settings > Appearance. The theme applies to both the terminal and the sidebar.

## Configuration

Drop a `.gustav` file in a repo root to customize session behavior. All sections are optional.

```ini
# Environment variables for new worktrees
[env]
DATABASE_URL=postgres://localhost/myapp_dev

# Files to copy from repo root into new worktrees
[copy]
config/.env.local
.claude/settings.local.json

# Install command (runs when "Run install" is checked)
[install]
cmd=npm ci

# Default base branch for new worktrees
[new]
base=origin/main

# Lifecycle hooks (receive WT_BRANCH and WT_PATH)
[hooks]
post_new=npm install

# Extra tmux windows added after Claude/Git/Shell
[tmux]
window=Tests:npm run test:watch
window=Build

# Branch for detecting merged worktrees during cleanup
[clean]
merged_into=origin/staging
```

## Scripts

| Command | What it does |
|---------|-------------|
| `npm run dev` | Run in development mode with hot reload |
| `npm run make` | Build and package the app |
| `npm test` | Run tests |
