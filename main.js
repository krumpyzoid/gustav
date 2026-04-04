const { app, BrowserWindow, ipcMain, Menu } = require("electron");
const pty = require("node-pty");
const { execSync, exec } = require("child_process");
const { readFileSync, readlinkSync, writeFileSync, mkdirSync, existsSync, watch } = require("fs");
const path = require("path");
const os = require("os");

let mainWindow;
let ptyProcess;
let refreshTimer;

// ── Repo registry ────────────────────────────────────────────────
const REGISTRY_DIR = path.join(os.homedir(), ".local", "share", "wt");
const REGISTRY_PATH = path.join(REGISTRY_DIR, "repos.json");

function loadRegistry() {
  try {
    return JSON.parse(readFileSync(REGISTRY_PATH, "utf8"));
  } catch {
    return {};
  }
}

function saveToRegistry(name, rootPath) {
  const registry = loadRegistry();
  if (registry[name] === rootPath) return;
  registry[name] = rootPath;
  mkdirSync(REGISTRY_DIR, { recursive: true });
  writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2) + "\n");
}

function removeFromRegistry(name) {
  const registry = loadRegistry();
  if (!(name in registry)) return;
  delete registry[name];
  mkdirSync(REGISTRY_DIR, { recursive: true });
  writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2) + "\n");
}

// ── Theme ─────────────────────────────────────────────────────────
const COLORS_TOML = path.join(os.homedir(), ".config/omarchy/current/theme/colors.toml");

const THEME_DIR = path.join(os.homedir(), ".config/omarchy/current/theme");
const GHOSTTY_CONF = path.join(THEME_DIR, "ghostty.conf");

function loadTheme() {
  // Try colors.toml first (standard Omarchy themes)
  try {
    const raw = readFileSync(COLORS_TOML, "utf8");
    const colors = {};
    for (const line of raw.split("\n")) {
      const m = line.match(/^(\w+)\s*=\s*"([^"]+)"/);
      if (m) colors[m[1]] = m[2];
    }
    if (Object.keys(colors).length > 0) return colors;
  } catch {}

  // Fall back to ghostty.conf (custom themes without colors.toml)
  try {
    const raw = readFileSync(GHOSTTY_CONF, "utf8");
    const colors = {};
    for (const line of raw.split("\n")) {
      const m = line.match(/^(\S+)\s*=\s*(.+)/);
      if (!m) continue;
      const [, key, val] = m;
      const v = val.trim();
      if (key === "background") colors.background = v;
      else if (key === "foreground") colors.foreground = v;
      else if (key === "cursor-color") colors.cursor = v;
      else if (key === "selection-background") colors.selection_background = v;
      else if (key === "selection-foreground") colors.selection_foreground = v;
      else if (key.startsWith("palette")) {
        // palette = N=#xxxxxx
        const pm = v.match(/^(\d+)=(#\w+)/);
        if (pm) colors[`color${pm[1]}`] = pm[2];
      }
    }
    // Derive accent from color4 (blue) if not set
    if (!colors.accent) colors.accent = colors.color4 || "#7daea3";
    if (Object.keys(colors).length > 0) return colors;
  } catch {}

  // Last resort fallback
  return {
    accent: "#7daea3", cursor: "#bdae93", foreground: "#d4be98",
    background: "#282828", selection_foreground: "#ebdbb2",
    selection_background: "#d65d0e",
    color0: "#3c3836", color1: "#ea6962", color2: "#a9b665",
    color3: "#d8a657", color4: "#7daea3", color5: "#d3869b",
    color6: "#89b482", color7: "#d4be98", color8: "#3c3836",
    color9: "#ea6962", color10: "#a9b665", color11: "#d8a657",
    color12: "#7daea3", color13: "#d3869b", color14: "#89b482",
    color15: "#d4be98",
  };
}

let lastThemeJson = "";

function sendThemeIfChanged() {
  const colors = loadTheme();
  const json = JSON.stringify(colors);
  if (json !== lastThemeJson) {
    lastThemeJson = json;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("theme-update", colors);
    }
  }
}

function watchTheme() {
  // Watch the entire current theme directory — catches both file edits
  // and directory replacement (omarchy-theme-set does rm + mv)
  try {
    watch(THEME_DIR, { persistent: false, recursive: true }, () => {
      setTimeout(sendThemeIfChanged, 300);
    });
  } catch {}

  // Also watch the parent dir to catch when the theme dir itself is replaced
  try {
    watch(path.dirname(THEME_DIR), { persistent: false }, () => {
      setTimeout(sendThemeIfChanged, 300);
    });
  } catch {}
}

// ── tmux helpers ──────────────────────────────────────────────────
function tmuxExec(cmd) {
  try {
    return execSync(`tmux ${cmd}`, { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

function collectState() {
  const entries = [];
  const repoSet = new Map();

  // Load persisted repos from registry
  const registry = loadRegistry();
  for (const [name, rootPath] of Object.entries(registry)) {
    if (existsSync(rootPath)) {
      repoSet.set(name, rootPath);
    }
  }

  // Discover repos from active tmux sessions
  const sessions = tmuxExec("list-sessions -F '#{session_name}'");

  if (sessions) {
    for (const name of sessions.split("\n")) {
      const trimmed = name.replace(/'/g, "");
      if (trimmed.startsWith("_wt_")) continue;

      const slashIdx = trimmed.indexOf("/");
      if (slashIdx === -1) {
        entries.push({
          repo: "standalone",
          branch: trimmed,
          tmuxSession: trimmed,
          status: "none",
          worktreePath: null,
          isMainWorktree: false,
        });
      } else {
        const repo = trimmed.slice(0, slashIdx);
        const branch = trimmed.slice(slashIdx + 1);
        const status = detectClaudeStatus(trimmed);
        entries.push({ repo, branch, tmuxSession: trimmed, status, worktreePath: null, isMainWorktree: false });

        if (!repoSet.has(repo)) {
          const panePath = tmuxExec(`display-message -t '${trimmed}' -p '#{pane_current_path}'`);
          if (panePath) {
            try {
              const gc = execSync(`git -C '${panePath}' rev-parse --git-common-dir`, { encoding: "utf8" }).trim();
              let root;
              if (gc === ".git") {
                root = execSync(`git -C '${panePath}' rev-parse --show-toplevel`, { encoding: "utf8" }).trim();
              } else if (gc) {
                root = path.dirname(gc);
              }
              if (root) {
                repoSet.set(repo, root);
                saveToRegistry(repo, root);
              }
            } catch {}
          }
        }
      }
    }
  }

  // Find orphaned worktrees (including main worktree)
  const activeNames = new Set(entries.map((e) => e.tmuxSession));
  for (const [repoName, repoRoot] of repoSet) {
    try {
      const wtDir = `${repoRoot}/.worktrees`;
      const out = execSync(`git -C '${repoRoot}' worktree list --porcelain`, { encoding: "utf8" });
      let curPath = "", curBranch = null;

      for (const line of out.split("\n")) {
        if (line.startsWith("worktree ")) {
          curPath = line.slice(9);
          curBranch = null;
        } else if (line.startsWith("branch refs/heads/")) {
          curBranch = line.slice(18);
        } else if (line === "" && curPath) {
          const isMain = curPath === repoRoot;
          const isUnderWtDir = curPath.startsWith(wtDir);

          if ((isUnderWtDir || isMain) && curBranch) {
            const sessionName = `${repoName}/${curBranch}`;
            if (!activeNames.has(sessionName)) {
              entries.push({
                repo: repoName,
                branch: curBranch,
                tmuxSession: null,
                status: "none",
                worktreePath: curPath,
                isMainWorktree: isMain,
              });
            } else {
              const entry = entries.find((e) => e.tmuxSession === sessionName);
              if (entry) {
                entry.worktreePath = curPath;
                entry.isMainWorktree = isMain;
              }
            }
          }
          curPath = "";
          curBranch = null;
        }
      }
    } catch {}
  }

  return { entries, repos: [...repoSet.entries()] };
}

// Track previous pane content to detect changes (= activity)
const prevPaneContent = {};

function detectClaudeStatus(session) {
  const panes = tmuxExec(`list-panes -t '${session}' -a -F '#{pane_id}\t#{window_name}\t#{pane_current_command}'`);
  if (!panes) return "none";

  let claudePaneId = null;
  for (const line of panes.split("\n")) {
    const [id, winName, cmd] = line.split("\t");
    if (winName === "Claude Code" && cmd === "claude") {
      claudePaneId = id;
      break;
    }
  }
  if (!claudePaneId) return "none";

  const content = tmuxExec(`capture-pane -t '${claudePaneId}' -p`);
  if (!content) return "none";

  const lines = content.split("\n").filter((l) => l.trim().length > 0);
  const tail = lines.slice(-10);
  const tailStr = tail.join("\n");

  // Tool approval prompts = needs user input (check first, highest priority)
  if (/\(y\s*=\s*yes|Allow|Approve|Do you want/.test(tailStr)) return "action";

  // Spinner line (starts with ✶ · ✢ * ✻ ✹)
  for (const line of tail) {
    const t = line.trim();
    if (/^[✶·✢✻✹*]/.test(t)) {
      const parenMatch = t.match(/\(([^)]+)\)\s*$/);
      if (parenMatch) {
        const inside = parenMatch[1];
        if (/ing\b/.test(inside)) return "busy";
        if (/for \d/.test(inside)) return "done";
      }
    }
    if (/⎿\s+\S.*ing/.test(t)) return "busy";
  }

  // Compare output area (skip last 6 lines = status bar + Frostgable)
  // If content changed since last poll, Claude is actively outputting = busy
  const outputArea = lines.slice(0, -6).join("\n");
  const prev = prevPaneContent[claudePaneId];
  prevPaneContent[claudePaneId] = outputArea;

  if (prev !== undefined && prev !== outputArea) return "busy";

  return "done";
}

function getPtyClientTty() {
  if (!ptyProcess) return null;
  try {
    return readlinkSync(`/proc/${ptyProcess.pid}/fd/0`);
  } catch {
    return null;
  }
}

// ── PTY ───────────────────────────────────────────────────────────
function startPty(cols, rows) {
  ptyProcess = pty.spawn("tmux", ["attach"], {
    name: "xterm-256color",
    cols,
    rows,
    cwd: process.env.HOME,
    env: { ...process.env, TERM: "xterm-256color" },
  });

  ptyProcess.onData((data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("pty-data", data);
    }
  });

  ptyProcess.onExit(() => {
    // tmux exited — check if other sessions exist and reconnect
    const sessions = tmuxExec("list-sessions -F '#{session_name}'");
    if (sessions) {
      // Restart PTY to attach to remaining sessions
      startPty(cols, rows);
    } else {
      app.quit();
    }
  });
}

// ── IPC ───────────────────────────────────────────────────────────
function setupIpc() {
  ipcMain.on("pty-input", (_event, data) => {
    ptyProcess?.write(data);
  });

  ipcMain.on("pty-resize", (_event, { cols, rows }) => {
    ptyProcess?.resize(cols, rows);
  });

  ipcMain.handle("get-state", () => {
    return collectState();
  });

  ipcMain.handle("switch-session", (_event, session) => {
    const tty = getPtyClientTty();
    if (tty) {
      tmuxExec(`switch-client -c '${tty}' -t '${session}'`);
    }
  });

  ipcMain.handle("kill-session", (_event, session) => {
    tmuxExec(`kill-session -t '${session}'`);
  });

  ipcMain.handle("remove-worktree", (_event, repoRoot, branch) => {
    try {
      execSync(`wt rm ${branch}`, { cwd: repoRoot, encoding: "utf8", timeout: 30000 });
    } catch {}
  });

  ipcMain.handle("create-session", (_event, name) => {
    tmuxExec(`new-session -d -s '${name}'`);
    const tty = getPtyClientTty();
    if (tty) tmuxExec(`switch-client -c '${tty}' -t '${name}'`);
  });

  ipcMain.handle("start-session", (_event, session, workdir) => {
    // Create tmux session for an orphan worktree
    const has = tmuxExec(`has-session -t '${session}'`);
    // has-session returns "" on both success and failure via tmuxExec,
    // so check directly
    let exists = false;
    try { execSync(`tmux has-session -t '${session}'`); exists = true; } catch {}

    if (!exists) {
      tmuxExec(`new-session -d -s '${session}' -n 'Claude Code' -c '${workdir}'`);
      try { execSync(`tmux send-keys -t '${session}:Claude Code' claude Enter`); } catch {}
      tmuxExec(`new-window -t '${session}' -n Git -c '${workdir}'`);
      try { execSync(`tmux send-keys -t '${session}:Git' lazygit Enter`); } catch {}
      tmuxExec(`new-window -t '${session}' -n Shell -c '${workdir}'`);
      tmuxExec(`select-window -t '${session}:Claude Code'`);
    }

    const tty = getPtyClientTty();
    if (tty) tmuxExec(`switch-client -c '${tty}' -t '${session}'`);
  });

  ipcMain.handle("create-worktree", (_event, repoRoot) => {
    const tty = getPtyClientTty();
    if (!tty) return;
    const clientSession = tmuxExec(`display-message -c '${tty}' -p '#{client_session}'`);
    if (clientSession) {
      try {
        execSync(`tmux new-window -t '${clientSession}' -n '+ worktree' -c '${repoRoot}' wt new`);
      } catch {}
    }
  });

  ipcMain.handle("remove-repo", (_event, repoName) => {
    removeFromRegistry(repoName);
  });

  ipcMain.handle("get-theme", () => loadTheme());
}

// ── App lifecycle ─────────────────────────────────────────────────
app.on("ready", () => {
  Menu.setApplicationMenu(null);

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile("index.html");
  setupIpc();

  // Start PTY and send initial theme after window is ready
  mainWindow.webContents.on("did-finish-load", () => {
    const colors = loadTheme();
    lastThemeJson = JSON.stringify(colors);
    mainWindow.webContents.send("theme-update", colors);
    startPty(80, 24);
    watchTheme();
  });

  // Refresh session state every 5s
  refreshTimer = setInterval(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("state-update", collectState());
    }
  }, 5000);
});

app.on("window-all-closed", () => {
  clearInterval(refreshTimer);
  ptyProcess?.kill();
  app.quit();
});
