import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";

declare const api: {
  onPtyData: (cb: (data: string) => void) => void;
  sendPtyInput: (data: string) => void;
  sendPtyResize: (cols: number, rows: number) => void;
  getState: () => Promise<{ entries: SessionEntry[]; repos: [string, string][] }>;
  onStateUpdate: (cb: (state: { entries: SessionEntry[]; repos: [string, string][] }) => void) => void;
  switchSession: (session: string) => Promise<void>;
  killSession: (session: string) => Promise<void>;
  removeWorktree: (repo: string, branch: string) => Promise<void>;
  createSession: (name: string) => Promise<void>;
  startSession: (session: string, workdir: string) => Promise<void>;
  createWorktree: (repoRoot: string) => Promise<void>;
  removeRepo: (repoName: string) => Promise<void>;
  getTheme: () => Promise<ThemeColors>;
  onThemeUpdate: (cb: (colors: ThemeColors) => void) => void;
};

type ThemeColors = Record<string, string>;
type ClaudeStatus = "action" | "busy" | "done" | "none";
type SessionEntry = {
  repo: string;
  branch: string;
  tmuxSession: string | null;
  status: ClaudeStatus;
  worktreePath: string | null;
  isMainWorktree: boolean;
};

// ── Theme ─────────────────────────────────────────────────────────
function applyTheme(c: ThemeColors) {
  const r = document.documentElement.style;
  r.setProperty("--bg", c.background || "#282828");
  r.setProperty("--fg", c.foreground || "#d4be98");
  r.setProperty("--accent", c.accent || "#7daea3");
  r.setProperty("--cursor", c.cursor || "#bdae93");
  r.setProperty("--sel-fg", c.selection_foreground || "#ebdbb2");
  r.setProperty("--sel-bg", c.selection_background || "#d65d0e");
  r.setProperty("--c0", c.color0 || "#3c3836");
  r.setProperty("--c1", c.color1 || "#ea6962");
  r.setProperty("--c2", c.color2 || "#a9b665");
  r.setProperty("--c3", c.color3 || "#d8a657");
  r.setProperty("--c4", c.color4 || "#7daea3");
  r.setProperty("--c5", c.color5 || "#d3869b");
  r.setProperty("--c6", c.color6 || "#89b482");
  r.setProperty("--c7", c.color7 || "#d4be98");
  r.setProperty("--c8", c.color8 || "#3c3836");
  r.setProperty("--c9", c.color9 || "#ea6962");
  r.setProperty("--c10", c.color10 || "#a9b665");
  r.setProperty("--c11", c.color11 || "#d8a657");
  r.setProperty("--c12", c.color12 || "#7daea3");
  r.setProperty("--c13", c.color13 || "#d3869b");
  r.setProperty("--c14", c.color14 || "#89b482");
  r.setProperty("--c15", c.color15 || "#d4be98");
  term.options.theme = xtermTheme(c);
}

function xtermTheme(c: ThemeColors) {
  return {
    background: c.background,
    foreground: c.foreground,
    cursor: c.cursor,
    selectionBackground: c.selection_background,
    selectionForeground: c.selection_foreground,
    black: c.color0, red: c.color1, green: c.color2, yellow: c.color3,
    blue: c.color4, magenta: c.color5, cyan: c.color6, white: c.color7,
    brightBlack: c.color8, brightRed: c.color9, brightGreen: c.color10,
    brightYellow: c.color11, brightBlue: c.color12, brightMagenta: c.color13,
    brightCyan: c.color14, brightWhite: c.color15,
  };
}

// ── Terminal setup ────────────────────────────────────────────────
const termContainer = document.getElementById("terminal-container")!;
const term = new Terminal({
  cursorBlink: true,
  fontFamily: '"JetBrainsMono Nerd Font", "JetBrains Mono", "Fira Code", monospace',
  fontSize: 13,
});
const fitAddon = new FitAddon();
term.loadAddon(fitAddon);
term.open(termContainer);

function fitTerminal() {
  fitAddon.fit();
  api.sendPtyResize(term.cols, term.rows);
}

setTimeout(fitTerminal, 100);
const resizeObserver = new ResizeObserver(() => fitTerminal());
resizeObserver.observe(termContainer);

api.onPtyData((data) => term.write(data));

term.attachCustomKeyEventHandler((event) => {
  if (event.key === "Enter" && event.shiftKey) {
    if (event.type === "keydown") api.sendPtyInput("\x1b[13;2u");
    return false;
  }
  return true;
});

term.onData((data) => api.sendPtyInput(data));

// ── Resize handle ─────────────────────────────────────────────────
const sidebar = document.getElementById("sidebar")!;
const handle = document.getElementById("resize-handle")!;

let dragging = false;

handle.addEventListener("mousedown", (e) => {
  dragging = true;
  handle.classList.add("dragging");
  document.body.style.cursor = "col-resize";
  document.body.style.userSelect = "none";
  e.preventDefault();
});

document.addEventListener("mousemove", (e) => {
  if (!dragging) return;
  const newWidth = Math.max(120, Math.min(400, e.clientX));
  sidebar.style.width = `${newWidth}px`;
  sidebar.style.minWidth = `${newWidth}px`;
  fitTerminal();
});

document.addEventListener("mouseup", () => {
  if (!dragging) return;
  dragging = false;
  handle.classList.remove("dragging");
  document.body.style.cursor = "";
  document.body.style.userSelect = "";
  fitTerminal();
});

// ── Sidebar ───────────────────────────────────────────────────────
const sessionsEl = document.getElementById("sessions")!;
const btnNewSession = document.getElementById("btn-new-session")!;

let currentActiveSession: string | null = null;
let lastEntries: SessionEntry[] = [];
let repoMap = new Map<string, string>(); // repo name -> repo root

function sortEntries(entries: SessionEntry[]): SessionEntry[] {
  return [...entries].sort((a, b) => {
    if (a.repo === "standalone" && b.repo !== "standalone") return 1;
    if (a.repo !== "standalone" && b.repo === "standalone") return -1;
    if (a.repo !== b.repo) return a.repo.localeCompare(b.repo);
    // Main worktree first within a repo
    if (a.isMainWorktree && !b.isMainWorktree) return -1;
    if (!a.isMainWorktree && b.isMainWorktree) return 1;
    return a.branch.localeCompare(b.branch);
  });
}

function statusLabel(status: ClaudeStatus): string {
  if (status === "action") return "needs input";
  if (status === "busy") return "working";
  if (status === "done") return "done";
  return "";
}

function renderSidebar(entries: SessionEntry[]) {
  const sorted = sortEntries(entries);
  lastEntries = sorted;
  sessionsEl.innerHTML = "";

  const groups = new Map<string, SessionEntry[]>();
  for (const entry of sorted) {
    const group = groups.get(entry.repo) ?? [];
    group.push(entry);
    groups.set(entry.repo, group);
  }

  for (const [repo, repoEntries] of groups) {
    const groupEl = document.createElement("div");
    groupEl.className = "repo-group";

    // Repo header
    const header = document.createElement("div");
    header.className = `repo-header${repo === "standalone" ? " standalone" : ""}`;
    header.textContent = repo;

    // Remove repo button (only when all sessions are dead)
    if (repo !== "standalone") {
      const hasActive = repoEntries.some((e) => e.tmuxSession !== null);
      if (!hasActive) {
        const rmBtn = document.createElement("button");
        rmBtn.className = "repo-remove-btn";
        rmBtn.textContent = "✕";
        rmBtn.title = "Remove repo from sidebar";
        rmBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          api.removeRepo(repo).then(refreshState);
        });
        header.appendChild(rmBtn);
      }
    }

    groupEl.appendChild(header);

    // Session entries
    for (const entry of repoEntries) {
      const row = document.createElement("div");
      row.className = "session-entry";
      if (entry.tmuxSession === null) row.classList.add("orphan");
      if (entry.tmuxSession === currentActiveSession) row.classList.add("active");

      // Status dot
      if (entry.repo !== "standalone" || entry.tmuxSession === null) {
        const dot = document.createElement("div");
        dot.className = `status-dot ${entry.status}`;
        row.appendChild(dot);
      }

      // Name + (dir) label
      const nameContainer = document.createElement("div");
      nameContainer.className = "session-name-block";

      const nameRow = document.createElement("div");
      nameRow.className = "session-name-row";

      const name = document.createElement("span");
      name.className = "session-name";
      name.textContent = entry.tmuxSession === null ? `○ ${entry.branch}` : entry.branch;
      nameRow.appendChild(name);

      if (entry.isMainWorktree) {
        const dirLabel = document.createElement("span");
        dirLabel.className = "dir-label";
        dirLabel.textContent = "(dir)";
        nameRow.appendChild(dirLabel);
      }

      nameContainer.appendChild(nameRow);

      // origin/branch reference line
      if (entry.repo !== "standalone") {
        const originRef = document.createElement("div");
        originRef.className = "origin-ref";
        originRef.textContent = `origin/${entry.branch}`;
        nameContainer.appendChild(originRef);
      }

      row.appendChild(nameContainer);

      // Status label
      const labelText = statusLabel(entry.status);
      if (labelText && entry.tmuxSession !== null) {
        const label = document.createElement("span");
        label.className = `status-label ${entry.status}`;
        label.textContent = labelText;
        row.appendChild(label);
      }

      // Action buttons (shown on hover)
      const actions = document.createElement("div");
      actions.className = "session-actions";

      if (entry.tmuxSession) {
        const killBtn = document.createElement("button");
        killBtn.title = "Kill tmux session";
        killBtn.textContent = "✕";
        killBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          if (confirm(`Kill session ${entry.tmuxSession}?`)) {
            api.killSession(entry.tmuxSession!).then(refreshState);
          }
        });
        actions.appendChild(killBtn);
      }

      if (entry.repo !== "standalone" && !entry.isMainWorktree) {
        const rmBtn = document.createElement("button");
        rmBtn.className = "btn-delete";
        rmBtn.title = "Delete worktree (wt rm)";
        rmBtn.textContent = "🗑";
        rmBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          const root = repoMap.get(entry.repo);
          if (root && confirm(`Delete worktree ${entry.branch}?\nThis removes the worktree directory, branch, and tmux session.`)) {
            api.removeWorktree(root, entry.branch).then(refreshState);
          }
        });
        actions.appendChild(rmBtn);
      }

      row.appendChild(actions);

      // Click to switch or start session
      row.addEventListener("click", () => {
        if (entry.tmuxSession) {
          currentActiveSession = entry.tmuxSession;
          api.switchSession(entry.tmuxSession);
          renderSidebar(lastEntries);
          term.focus();
        } else if (entry.worktreePath) {
          const session = `${entry.repo}/${entry.branch}`;
          api.startSession(session, entry.worktreePath).then(() => {
            currentActiveSession = session;
            setTimeout(refreshState, 500);
            term.focus();
          });
        }
      });

      groupEl.appendChild(row);
    }

    // "+ new worktree" row for non-standalone repos
    if (repo !== "standalone") {
      const addRow = document.createElement("div");
      addRow.className = "session-entry add-worktree";
      const addLabel = document.createElement("span");
      addLabel.className = "add-worktree-label";
      addLabel.textContent = "+ new worktree";
      addRow.appendChild(addLabel);

      addRow.addEventListener("click", () => {
        const root = repoMap.get(repo);
        if (root) {
          api.createWorktree(root);
          term.focus();
        }
      });

      groupEl.appendChild(addRow);
    }

    sessionsEl.appendChild(groupEl);
  }
}

async function refreshState() {
  const state = await api.getState();
  repoMap = new Map(state.repos);
  renderSidebar(state.entries);
}

// New session inline input
btnNewSession.addEventListener("click", () => {
  const actionBar = document.getElementById("action-bar")!;
  const existingInput = actionBar.querySelector(".inline-input");
  if (existingInput) { existingInput.remove(); return; }

  btnNewSession.style.display = "none";

  const wrapper = document.createElement("div");
  wrapper.className = "inline-input";
  wrapper.style.cssText = "display:flex;gap:4px;flex:1;";

  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "session name...";
  input.className = "session-input";

  const cancel = document.createElement("button");
  cancel.textContent = "✕";
  cancel.className = "cancel-btn";

  wrapper.appendChild(input);
  wrapper.appendChild(cancel);
  actionBar.appendChild(wrapper);
  input.focus();

  const cleanup = () => {
    wrapper.remove();
    btnNewSession.style.display = "";
  };

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && input.value.trim()) {
      api.createSession(input.value.trim());
      cleanup();
      setTimeout(refreshState, 500);
      term.focus();
    }
    if (e.key === "Escape") {
      cleanup();
      term.focus();
    }
  });

  cancel.addEventListener("click", () => {
    cleanup();
    term.focus();
  });
});

// ── Init ──────────────────────────────────────────────────────────
api.getTheme().then((colors) => {
  applyTheme(colors);
  fitTerminal();
});
api.onThemeUpdate((colors) => applyTheme(colors));

api.getState().then((state) => {
  repoMap = new Map(state.repos);
  renderSidebar(state.entries);
  if (state.entries.length > 0) {
    const first = state.entries.find((e) => e.tmuxSession && e.repo !== "standalone");
    if (first) currentActiveSession = first.tmuxSession;
  }
});

api.onStateUpdate((state) => {
  repoMap = new Map(state.repos);
  renderSidebar(state.entries);
});

term.focus();
