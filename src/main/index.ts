import { app, BrowserWindow, ipcMain, Menu } from 'electron';
import * as pty from 'node-pty';
import path from 'node:path';

import { FsAdapter } from './adapters/fs.adapter';
import { ShellAdapter } from './adapters/shell.adapter';
import { GitAdapter } from './adapters/git.adapter';
import { TmuxAdapter } from './adapters/tmux.adapter';

import { ConfigService } from './services/config.service';
import { WorkspaceService } from './services/workspace.service';
import { SessionService } from './services/session.service';
import { ThemeService } from './services/theme.service';
import { StateService } from './services/state.service';
import { WorktreeService } from './services/worktree.service';

import { registerHandlers } from './ipc/handlers';
import { Channels } from './ipc/channels';

let mainWindow: BrowserWindow | null = null;
let ptyProcess: pty.IPty | null = null;
let activeSession: string | null = null;

// ── Adapters ──────────────────────────────────────────────────────
const fsAdapter = new FsAdapter();
const shellAdapter = new ShellAdapter();
const gitAdapter = new GitAdapter(shellAdapter);
const tmuxAdapter = new TmuxAdapter(shellAdapter);

// ── Services ──────────────────────────────────────────────────────
const configService = new ConfigService(fsAdapter);
const workspaceService = new WorkspaceService(fsAdapter);
const sessionService = new SessionService(tmuxAdapter);
const themeService = new ThemeService(fsAdapter);
const stateService = new StateService(gitAdapter, tmuxAdapter, workspaceService);
const worktreeService = new WorktreeService(
  gitAdapter, fsAdapter, shellAdapter, configService, sessionService, workspaceService,
);

// ── PTY ───────────────────────────────────────────────────────────
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

function startPty(cols: number, rows: number): void {
  ptyProcess = pty.spawn('tmux', ['attach'], {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: process.env.HOME,
    env: { ...process.env, TERM: 'xterm-256color' } as Record<string, string>,
  });

  ptyProcess.onData((data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(Channels.PTY_DATA, data);
    }
  });

  ptyProcess.onExit(() => {
    // Sync check for remaining sessions — reattach if any exist,
    // otherwise stay alive so the user can create new sessions from the sidebar
    try {
      const s = require('node:child_process').execSync('tmux list-sessions -F "#{session_name}"', { encoding: 'utf-8' });
      if (s.trim()) {
        startPty(cols, rows);
      } else {
        ptyProcess = null;
      }
    } catch {
      ptyProcess = null;
    }
  });
}

// ── PTY IPC (fire-and-forget) ─────────────────────────────────────
ipcMain.on(Channels.PTY_INPUT, (_event, data) => {
  ptyProcess?.write(data);
});

ipcMain.on(Channels.PTY_RESIZE, (_event, { cols, rows }: { cols: number; rows: number }) => {
  ptyProcess?.resize(cols, rows);
});

// ── App lifecycle ─────────────────────────────────────────────────
app.on('ready', () => {
  Menu.setApplicationMenu(null);

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  // Load renderer
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  // Register IPC handlers
  registerHandlers({
    worktreeService,
    sessionService,
    stateService,
    themeService,
    workspaceService,
    configService,
    tmux: tmuxAdapter,
    git: gitAdapter,
    getPtyClientTty,
    getActiveSession: () => activeSession,
    setActiveSession: (session: string) => { activeSession = session; },
    ensurePty: () => {
      if (!ptyProcess) startPty(80, 24);
    },
  });

  // Prevent Electron's built-in zoom so Ctrl+/- reaches the renderer for terminal font sizing
  mainWindow.webContents.on('before-input-event', (_event, input) => {
    if (input.control && (input.key === '=' || input.key === '+' || input.key === '-' || input.key === '0')) {
      mainWindow!.webContents.setZoomLevel(0);
    }
  });

  // Start PTY and theme after window is ready
  mainWindow.webContents.on('did-finish-load', () => {
    const colors = themeService.load();
    mainWindow!.webContents.send(Channels.THEME_UPDATE, colors);
    startPty(80, 24);
    themeService.startWatching();
  });

  // Theme change broadcasts
  themeService.onChange((colors) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(Channels.THEME_UPDATE, colors);
    }
  });

  // State polling — broadcast every 5s
  stateService.onChange((state) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(Channels.STATE_UPDATE, state);
    }
  });
  stateService.startPolling(1000, () => activeSession);
});

app.on('window-all-closed', () => {
  stateService.stopPolling();
  ptyProcess?.kill();
  app.quit();
});
