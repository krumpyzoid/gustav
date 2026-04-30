import { app, BrowserWindow, clipboard, ipcMain, Menu } from 'electron';
import * as pty from 'node-pty';
import path from 'node:path';
import { execSync } from 'node:child_process';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isHeadless, bootHeadless } from './headless';

// Fix environment for packaged macOS apps launched from Finder/Dock.
// These inherit a minimal environment that lacks Homebrew PATH and
// locale variables (LANG, LC_CTYPE), causing broken UTF-8 rendering.
if (app.isPackaged && process.platform === 'darwin') {
  try {
    const shell = process.env.SHELL || '/bin/zsh';
    // Use a marker to extract values from shell output,
    // avoiding interference from shell startup messages/motd.
    const marker = `__ENV_${Date.now()}__`;
    const raw = execSync(
      `${shell} -ilc 'echo ${marker}; echo "$PATH"; echo "$LANG"; echo "$LC_CTYPE"; echo ${marker}'`,
      { encoding: 'utf-8', timeout: 5000 },
    );
    const lines = raw.split('\n');
    const startIdx = lines.indexOf(marker);
    const endIdx = lines.indexOf(marker, startIdx + 1);
    if (startIdx !== -1 && endIdx !== -1) {
      const values = lines.slice(startIdx + 1, endIdx);
      const fullPath = values[0]?.trim();
      const lang = values[1]?.trim();
      const lcCtype = values[2]?.trim();
      if (fullPath) process.env.PATH = fullPath;
      process.env.LANG = lang || 'en_US.UTF-8';
      process.env.LC_CTYPE = lcCtype || 'en_US.UTF-8';
    }
  } catch {
    // Fall through with defaults; ensure UTF-8 locale at minimum
    if (!process.env.LANG) process.env.LANG = 'en_US.UTF-8';
    if (!process.env.LC_CTYPE) process.env.LC_CTYPE = 'en_US.UTF-8';
  }
}

import { FsAdapter } from './adapters/fs.adapter';
import { ShellAdapter } from './adapters/shell.adapter';
import { GitAdapter } from './adapters/git.adapter';
import { TmuxAdapter } from './adapters/tmux.adapter';

import { RepoConfigService } from './services/repo-config.service';
import { WorkspaceService } from './services/workspace.service';
import { SessionService } from './services/session.service';
import { SessionLauncherService } from './services/session-launcher.service';
import { ThemeService } from './services/theme.service';
import { PreferenceService } from './services/preference.service';
import { StateService } from './services/state.service';
import { WorktreeService } from './services/worktree.service';
import { ClaudeSessionTracker } from './services/claude-session-tracker';
import { ClaudeLogObserver } from './services/claude-log-observer';

import { registerHandlers } from './ipc/handlers';
import { registerSupervisorHandlers } from './ipc/supervisor-handlers';
import { Channels } from './ipc/channels';
import { RemoteService } from './remote/remote.service';
import { RemoteClientService } from './remote/remote-client.service';
import { NativeSupervisor } from './supervisor/native-supervisor';
import { nodePtyFactory } from './supervisor/node-pty-factory';

let mainWindow: BrowserWindow | null = null;
let ptyProcess: pty.IPty | null = null;
let activeSession: string | null = null;

// ── Adapters ──────────────────────────────────────────────────────
const fsAdapter = new FsAdapter();
const shellAdapter = new ShellAdapter();
const gitAdapter = new GitAdapter(shellAdapter);
const tmuxAdapter = new TmuxAdapter(shellAdapter);

// ── Services ──────────────────────────────────────────────────────
const repoConfigService = new RepoConfigService();
const workspaceService = new WorkspaceService(fsAdapter);
const sessionService = new SessionService(tmuxAdapter);
const preferenceService = new PreferenceService();
const themeService = new ThemeService(fsAdapter);
const claudeLogObserver = new ClaudeLogObserver();
const claudeTracker = new ClaudeSessionTracker(tmuxAdapter, shellAdapter, fsAdapter, workspaceService, claudeLogObserver);

// Phase 3: native session supervisor. Always instantiated (cheap if unused);
// the strangler flag in preferences (`sessionSupervisor: 'tmux' | 'native'`)
// determines whether new sessions opt in. Existing tmux sessions stay tmux.
const nativeSupervisor = new NativeSupervisor({
  ptyFactory: nodePtyFactory,
  assistantLog: claudeLogObserver,
});

// StateService unions tmux + supervisor sessions, so it must be wired after
// nativeSupervisor is constructed.
const stateService = new StateService(gitAdapter, tmuxAdapter, workspaceService, claudeLogObserver, nativeSupervisor);

// SessionLauncherService picks tmux vs native at session creation time,
// reading the strangler flag on each call. Existing sessions stay on
// whichever backend originally created them.
const sessionLauncher = new SessionLauncherService(sessionService, nativeSupervisor, preferenceService);

const dataDir = require('node:path').join(require('node:os').homedir(), '.local', 'share', 'gustav');
const worktreeService = new WorktreeService(
  gitAdapter, fsAdapter, shellAdapter, repoConfigService, sessionService, workspaceService,
);
const remoteService = new RemoteService({
  stateService, sessionService, workspaceService, worktreeService,
  repoConfigService, preferenceService,
  sessionLauncher, supervisor: nativeSupervisor,
  git: gitAdapter, tmux: tmuxAdapter, shell: shellAdapter, dataDir,
});
const remoteClientService = new RemoteClientService(dataDir);

// Apply saved theme preference at startup
themeService.setPreference(preferenceService.load().theme);

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
  // Enable mouse mode globally so tmux interprets wheel events as
  // scrollback navigation instead of letting them become arrow keys.
  try {
    execSync('tmux set -g mouse on', { encoding: 'utf-8', timeout: 3000 });
  } catch {
    // tmux server might not be running yet — sessions will set it individually
  }

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

// Clipboard writes go through main because navigator.clipboard.writeText
// silently fails on macOS when the renderer window is unfocused.
ipcMain.on(Channels.CLIPBOARD_WRITE, (_event, text: string) => {
  if (typeof text === 'string' && text.length > 0) {
    clipboard.writeText(text);
  }
});

// ── Headless mode detection ───────────────────────────────────────
// `GUSTAV_HEADLESS=1` (preferred, matches systemd patterns) or `--headless`
// boots Gustav without a BrowserWindow. The remote protocol is the only
// client surface in this mode. See `docs/specs/headless-deployment.md`.
const HEADLESS = isHeadless({ env: process.env, argv: process.argv });

/** Compute the SHA-256 fingerprint of the server's TLS cert, formatted AA:BB:... */
function getServerCertFingerprint(): string | null {
  try {
    const certPath = require('node:path').join(dataDir, 'remote', 'server.cert');
    const certPem = readFileSync(certPath, 'utf-8');
    const x509 = new crypto.X509Certificate(certPem);
    return x509.fingerprint256;
  } catch {
    return null;
  }
}

// ── App lifecycle ─────────────────────────────────────────────────
app.on('ready', async () => {
  Menu.setApplicationMenu(null);

  if (HEADLESS) {
    // Headless boot: no BrowserWindow, no PTY, no renderer. Remote protocol
    // is the only client. Pairing code & cert fingerprint are printed to
    // stdout for the operator (journalctl).
    const remotePort = (() => {
      const envPort = Number(process.env.GUSTAV_REMOTE_PORT);
      if (Number.isFinite(envPort) && envPort > 0) return envPort;
      return 7777;
    })();

    // Apply theme preference at startup (already done above for the local path)
    themeService.setPreference(preferenceService.load().theme);

    await bootHeadless({
      port: remotePort,
      remoteService,
      stateService,
      themeService,
      registerHandlers: (deps) => registerHandlers({
        worktreeService,
        sessionService,
        sessionLauncher,
        supervisor: nativeSupervisor,
        stateService,
        themeService,
        workspaceService,
        repoConfigService,
        preferenceService,
        tmux: tmuxAdapter,
        shell: shellAdapter,
        git: gitAdapter,
        getPtyClientTty,
        getActiveSession: () => activeSession,
        setActiveSession: (session: string) => { activeSession = session; },
        ensurePty: () => {
          // No-op in headless: there is no UI to render the local PTY into.
          // The user's primary terminal is reachable via tmux/supervisor
          // through the remote protocol's attach-pty path instead.
        },
        broadcastTheme: () => {
          // No-op in headless: themes are resolved per-client by the remote
          // server when it forwards state, not pushed by the host.
        },
        remoteService,
        remoteClientService,
        broadcastToRenderer: deps.broadcastToRenderer as (channel: string, ...args: unknown[]) => void,
      }),
      registerSupervisorHandlers: (deps) => registerSupervisorHandlers({
        supervisor: nativeSupervisor,
        broadcastToRenderer: deps.broadcastToRenderer as (channel: string, ...args: unknown[]) => void,
      }),
      getFingerprint: getServerCertFingerprint,
      log: (line) => console.log(line),
      onStateTick: async () => {
        // Mirror the local boot path: scan persisted sessions for Claude
        // processes and feed their session IDs into the JSONL observer so
        // status events stay accurate for any client that attaches.
        await claudeTracker.captureAll(workspaceService.list());
      },
    });
    return;
  }

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 18 },
    icon: path.join(process.resourcesPath, 'icon.png'),
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

  function broadcastTheme() {
    const pref = preferenceService.load().theme;
    themeService.setPreference(pref);
    const colors = themeService.resolve();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(Channels.THEME_UPDATE, colors);
    }
  }

  // Register IPC handlers
  registerHandlers({
    worktreeService,
    sessionService,
    sessionLauncher,
    supervisor: nativeSupervisor,
    stateService,
    themeService,
    workspaceService,
    repoConfigService,
    preferenceService,
    tmux: tmuxAdapter,
    shell: shellAdapter,
    git: gitAdapter,
    getPtyClientTty,
    getActiveSession: () => activeSession,
    setActiveSession: (session: string) => { activeSession = session; },
    ensurePty: () => {
      if (!ptyProcess) startPty(80, 24);
    },
    broadcastTheme,
    remoteService,
    remoteClientService,
    broadcastToRenderer: (channel: string, ...args: unknown[]) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(channel, ...args);
      }
    },
  });

  // Wire supervisor IPC and broadcast supervisor events to the renderer.
  registerSupervisorHandlers({
    supervisor: nativeSupervisor,
    broadcastToRenderer: (channel: string, ...args: unknown[]) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(channel, ...args);
      }
    },
  });

  // Wire remote client events to renderer
  remoteClientService.onStateUpdate((state) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(Channels.REMOTE_STATE_UPDATE, state);
    }
  });
  remoteClientService.onPtyData((data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      // Decode binary frame in main process — send only the payload string to renderer
      // Frame format: [1 byte channel type][4 bytes channel ID][N bytes payload]
      const payload = Buffer.isBuffer(data) && data.length > 5 ? data.subarray(5).toString() : '';
      mainWindow.webContents.send(Channels.REMOTE_PTY_DATA, payload);
    }
  });
  remoteClientService.onStatusChange((status) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(Channels.REMOTE_CONNECTION_STATUS, status);
    }
  });

  // Prevent Electron's built-in zoom so Ctrl+/- reaches the renderer for terminal font sizing
  mainWindow.webContents.on('before-input-event', (_event, input) => {
    if (input.control && (input.key === '=' || input.key === '+' || input.key === '-' || input.key === '0')) {
      mainWindow!.webContents.setZoomLevel(0);
    }
  });

  // Start PTY and theme after window is ready
  mainWindow.webContents.on('did-finish-load', async () => {
    const colors = themeService.resolve();
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

  // State polling — broadcast every 1s, also capture Claude session IDs
  stateService.onChange(async (state) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(Channels.STATE_UPDATE, state);
    }
    // Forward state to connected remote client
    remoteService.broadcastState(state);
    // Capture Claude session IDs in the background (fire-and-forget)
    try {
      await claudeTracker.captureAll(workspaceService.list());
    } catch {
      // Non-critical — session IDs will be captured on next poll
    }
  });
  stateService.startPolling(1000, () => activeSession);
});

app.on('window-all-closed', () => {
  // In headless mode there are no windows, so this fires only after the
  // (non-existent) windows close — i.e., never under normal operation.
  // Do not quit the app from this hook when headless; rely on SIGTERM.
  if (HEADLESS) return;
  stateService.stopPolling();
  claudeLogObserver.close();
  nativeSupervisor.close();
  ptyProcess?.kill();
  app.quit();
});

// Graceful shutdown for headless deployments. systemd sends SIGTERM on
// `systemctl stop`; the process must drain in-flight remote sessions and
// release supervisor PTYs before exiting.
function shutdownAndExit(code = 0): void {
  try { stateService.stopPolling(); } catch {}
  try { claudeLogObserver.close(); } catch {}
  try { nativeSupervisor.close(); } catch {}
  try { ptyProcess?.kill(); } catch {}
  try { app.quit(); } catch {}
  // Give the event loop one tick to flush, then force-exit.
  setTimeout(() => process.exit(code), 100).unref();
}

if (HEADLESS) {
  process.on('SIGTERM', () => shutdownAndExit(0));
  process.on('SIGINT', () => shutdownAndExit(0));
}
