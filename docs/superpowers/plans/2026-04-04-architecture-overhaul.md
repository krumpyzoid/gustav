# Gustav Architecture Overhaul — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite Gustav from a 3-file Electron MVP into a clean-architecture app with React/shadcn renderer and built-in worktree management, eliminating the `wt` CLI dependency.

**Architecture:** Hybrid Services + Ports. Services contain business logic and depend on port interfaces (GitPort, TmuxPort, FileSystemPort, ShellPort). Adapters implement ports via CLI/OS calls. IPC handlers are thin wrappers. Renderer uses React + Zustand + shadcn/ui (Base UI).

**Tech Stack:** Electron 35, electron-vite, React 19, TypeScript (strict), Tailwind CSS v4, shadcn/ui (Base UI), Zustand, xterm.js, node-pty

**Spec:** `docs/superpowers/specs/2026-04-04-architecture-overhaul-design.md`

---

## File Map

### Root configs (create)
- `electron.vite.config.ts` — electron-vite config for main/preload/renderer
- `tsconfig.json` — base TS config with project references
- `tsconfig.main.json` — main process (Node, ES2022)
- `tsconfig.preload.json` — preload (Node, restricted)
- `tsconfig.renderer.json` — renderer (DOM, React JSX)
- `components.json` — shadcn/ui config (Base UI)
- `package.json` — rewrite with new deps and scripts

### Root configs (delete)
- `main.js` — replaced by `src/main/index.ts`
- `preload.js` — replaced by `src/preload/index.ts`
- `index.html` — replaced by `src/renderer/index.html`
- `styles.css` — replaced by `src/renderer/styles/globals.css`
- `src/renderer.ts` — replaced by React components
- `dist/` — replaced by `out/` (electron-vite output)

### Main process (create all)
- `src/main/index.ts` — app lifecycle, window, DI wiring, PTY
- `src/main/domain/types.ts` — all shared types
- `src/main/ipc/channels.ts` — channel constants
- `src/main/ipc/handlers.ts` — all IPC handlers
- `src/main/ports/git.port.ts` — GitPort interface
- `src/main/ports/tmux.port.ts` — TmuxPort interface
- `src/main/ports/filesystem.port.ts` — FileSystemPort interface
- `src/main/ports/shell.port.ts` — ShellPort interface
- `src/main/adapters/git.adapter.ts` — GitPort impl
- `src/main/adapters/tmux.adapter.ts` — TmuxPort impl
- `src/main/adapters/fs.adapter.ts` — FileSystemPort impl
- `src/main/adapters/shell.adapter.ts` — ShellPort impl
- `src/main/services/config.service.ts` — .wt config parser
- `src/main/services/registry.service.ts` — repo registry CRUD
- `src/main/services/session.service.ts` — tmux session lifecycle
- `src/main/services/theme.service.ts` — Omarchy theme loading
- `src/main/services/state.service.ts` — state aggregation + claude detection
- `src/main/services/worktree.service.ts` — create/remove/clean worktrees

### Preload (create all)
- `src/preload/index.ts` — contextBridge typed API
- `src/preload/api.d.ts` — Window.api type declarations

### Renderer (create all)
- `src/renderer/index.html` — entry HTML
- `src/renderer/main.tsx` — React root
- `src/renderer/App.tsx` — layout shell
- `src/renderer/lib/utils.ts` — shadcn cn() utility
- `src/renderer/styles/globals.css` — Tailwind + theme vars
- `src/renderer/hooks/use-app-state.ts` — Zustand store + IPC subscription
- `src/renderer/hooks/use-theme.ts` — theme IPC subscription
- `src/renderer/hooks/use-terminal.ts` — xterm lifecycle
- `src/renderer/components/sidebar/Sidebar.tsx`
- `src/renderer/components/sidebar/RepoGroup.tsx`
- `src/renderer/components/sidebar/SessionEntry.tsx`
- `src/renderer/components/sidebar/StatusDot.tsx`
- `src/renderer/components/sidebar/ActionBar.tsx`
- `src/renderer/components/terminal/Terminal.tsx`
- `src/renderer/components/terminal/ResizeHandle.tsx`
- `src/renderer/components/dialogs/NewWorktreeDialog.tsx`
- `src/renderer/components/dialogs/CleanWorktreesDialog.tsx`
- `src/renderer/components/dialogs/RemoveWorktreeDialog.tsx`
- `src/renderer/components/dialogs/NewSessionDialog.tsx`
- `src/renderer/components/dialogs/ConfirmDialog.tsx`

---

## Task 1: Project Scaffold — Package & Build Config

**Files:**
- Rewrite: `package.json`
- Create: `electron.vite.config.ts`
- Create: `tsconfig.json`, `tsconfig.main.json`, `tsconfig.preload.json`, `tsconfig.renderer.json`
- Delete: `dist/`

- [ ] **Step 1: Rewrite package.json**

```json
{
  "name": "gustav",
  "version": "0.2.0",
  "private": true,
  "main": "./out/main/index.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "start": "electron-vite preview",
    "postinstall": "electron-rebuild"
  },
  "dependencies": {
    "@xterm/addon-fit": "^0.10.0",
    "@xterm/xterm": "^5.5.0",
    "node-pty": "^1.1.0",
    "zustand": "^5.0.0"
  },
  "devDependencies": {
    "@electron/rebuild": "^3.7.0",
    "@tailwindcss/vite": "^4.0.0",
    "@types/node": "^22.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.4.0",
    "electron": "^35.0.0",
    "electron-vite": "^2.4.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "tailwindcss": "^4.0.0",
    "typescript": "^5.7.0"
  }
}
```

- [ ] **Step 2: Create electron.vite.config.ts**

```typescript
import { defineConfig } from 'electron-vite'
import { resolve } from 'path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    build: {
      outDir: 'out/main',
      rollupOptions: {
        external: ['node-pty']
      }
    }
  },
  preload: {
    build: {
      outDir: 'out/preload'
    }
  },
  renderer: {
    root: 'src/renderer',
    build: {
      outDir: 'out/renderer',
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html')
        }
      }
    },
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer')
      }
    }
  }
})
```

- [ ] **Step 3: Create tsconfig.json (base with project references)**

```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.main.json" },
    { "path": "./tsconfig.preload.json" },
    { "path": "./tsconfig.renderer.json" }
  ]
}
```

- [ ] **Step 4: Create tsconfig.main.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "outDir": "out/main",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true
  },
  "include": ["src/main/**/*"]
}
```

- [ ] **Step 5: Create tsconfig.preload.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "outDir": "out/preload",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "isolatedModules": true,
    "noEmit": true
  },
  "include": ["src/preload/**/*", "src/main/domain/types.ts"]
}
```

- [ ] **Step 6: Create tsconfig.renderer.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "outDir": "out/renderer",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/renderer/*"]
    }
  },
  "include": ["src/renderer/**/*", "src/preload/api.d.ts"]
}
```

- [ ] **Step 7: Delete old build artifacts and files**

```bash
rm -rf dist/
```

- [ ] **Step 8: Install dependencies**

```bash
npm install
```

Expected: all deps resolve cleanly. `node_modules/` populated.

- [ ] **Step 9: Commit**

```bash
git add package.json electron.vite.config.ts tsconfig.json tsconfig.main.json tsconfig.preload.json tsconfig.renderer.json
git commit -m "scaffold: electron-vite project with TypeScript configs"
```

---

## Task 2: Domain Types + Port Interfaces + IPC Channels

**Files:**
- Create: `src/main/domain/types.ts`
- Create: `src/main/ports/git.port.ts`
- Create: `src/main/ports/tmux.port.ts`
- Create: `src/main/ports/filesystem.port.ts`
- Create: `src/main/ports/shell.port.ts`
- Create: `src/main/ipc/channels.ts`

- [ ] **Step 1: Create src/main/domain/types.ts**

```typescript
// ── Result type for IPC responses ─────────────────────────────────
export type Result<T> =
  | { success: true; data: T }
  | { success: false; error: string };

// ── Claude status ─────────────────────────────────────────────────
export type ClaudeStatus = 'action' | 'busy' | 'done' | 'none';

// ── Session / state ───────────────────────────────────────────────
export type SessionEntry = {
  repo: string;
  branch: string;
  tmuxSession: string | null;
  status: ClaudeStatus;
  worktreePath: string | null;
  isMainWorktree: boolean;
};

export type AppState = {
  entries: SessionEntry[];
  repos: [name: string, path: string][];
};

// ── Theme ─────────────────────────────────────────────────────────
export type ThemeColors = Record<string, string>;

// ── Branch info (for new worktree dialog) ─────────────────────────
export type BranchInfo = {
  name: string;
  isLocal: boolean;
  isRemote: boolean;
};

// ── Worktree operations ───────────────────────────────────────────
export type CreateWorktreeParams = {
  repo: string;
  repoRoot: string;
  branch: string;
  base: string;
  install: boolean;
};

export type CleanCandidate = {
  repo: string;
  repoRoot: string;
  branch: string;
  worktreePath: string;
  reason: 'merged' | 'remote-deleted';
};

export type CleanTarget = {
  repoRoot: string;
  branch: string;
  worktreePath: string;
  deleteBranch: boolean;
};

export type CleanReport = {
  removed: number;
  errors: string[];
};

// ── .wt config ────────────────────────────────────────────────────
export type WtConfig = {
  env: Record<string, string>;
  copy: string[];
  install: string;
  base: string;
  hooks: Record<string, string>;
  tmux: string[];
  cleanMergedInto: string;
};

// ── Git types used by ports ───────────────────────────────────────
export type WorktreeEntry = {
  path: string;
  branch: string | null;
  head: string;
};

export type BranchExistence = 'local' | 'remote' | null;
```

- [ ] **Step 2: Create src/main/ports/git.port.ts**

```typescript
import type { WorktreeEntry, BranchExistence, BranchInfo } from '../domain/types';

export interface GitPort {
  getRepoRoot(cwd: string): Promise<string>;
  getWorktreeDir(repoRoot: string): string;
  listWorktrees(repoRoot: string, wtDir: string, opts?: { includeMain?: boolean }): Promise<WorktreeEntry[]>;
  branchExists(repoRoot: string, branch: string): Promise<BranchExistence>;
  listBranches(repoRoot: string): Promise<BranchInfo[]>;
  isBranchMerged(repoRoot: string, branch: string, into: string): Promise<boolean>;
  fetch(repoRoot: string, opts?: { prune?: boolean }): Promise<void>;
  worktreeAdd(repoRoot: string, path: string, branch: string, opts?: { newBranch?: boolean; base?: string }): Promise<void>;
  worktreeRemove(repoRoot: string, path: string): Promise<void>;
  worktreePrune(repoRoot: string): Promise<void>;
  branchDelete(repoRoot: string, branch: string): Promise<void>;
  worktreeListPorcelain(repoRoot: string): Promise<string>;
}
```

- [ ] **Step 3: Create src/main/ports/tmux.port.ts**

```typescript
export interface TmuxPort {
  exec(cmd: string): Promise<string>;
  listSessions(): Promise<string[]>;
  hasSession(session: string): Promise<boolean>;
  newSession(name: string, opts: { windowName: string; cwd: string }): Promise<void>;
  killSession(session: string): Promise<void>;
  switchClient(tty: string, target: string): Promise<void>;
  newWindow(session: string, name: string, cwd: string): Promise<void>;
  sendKeys(target: string, keys: string): Promise<void>;
  selectWindow(session: string, window: string): Promise<void>;
  listPanes(session: string): Promise<string>;
  capturePaneContent(paneId: string): Promise<string>;
  displayMessage(target: string, format: string): Promise<string>;
}
```

- [ ] **Step 4: Create src/main/ports/filesystem.port.ts**

```typescript
export interface FileSystemPort {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  exists(path: string): boolean;
  mkdir(path: string): Promise<void>;
  copyFile(src: string, dest: string): Promise<void>;
  copyRecursive(src: string, dest: string): Promise<void>;
  readlink(path: string): string;
  watch(path: string, opts: { recursive?: boolean }, cb: () => void): void;
}
```

- [ ] **Step 5: Create src/main/ports/shell.port.ts**

```typescript
export interface ShellPort {
  exec(cmd: string, opts?: { cwd?: string; env?: Record<string, string>; timeout?: number }): Promise<string>;
  execSync(cmd: string, opts?: { cwd?: string; encoding?: string; timeout?: number }): string;
}
```

- [ ] **Step 6: Create src/main/ipc/channels.ts**

```typescript
export const Channels = {
  // Queries
  GET_STATE: 'get-state',
  GET_THEME: 'get-theme',
  GET_BRANCHES: 'get-branches',
  GET_CLEAN_CANDIDATES: 'get-clean-candidates',

  // Commands
  SWITCH_SESSION: 'switch-session',
  KILL_SESSION: 'kill-session',
  CREATE_SESSION: 'create-session',
  START_SESSION: 'start-session',
  CREATE_WORKTREE: 'create-worktree',
  REMOVE_WORKTREE: 'remove-worktree',
  CLEAN_WORKTREES: 'clean-worktrees',
  REMOVE_REPO: 'remove-repo',

  // Streams (fire-and-forget)
  PTY_INPUT: 'pty-input',
  PTY_RESIZE: 'pty-resize',

  // Events (main → renderer)
  STATE_UPDATE: 'state-update',
  THEME_UPDATE: 'theme-update',
  PTY_DATA: 'pty-data',
} as const;
```

- [ ] **Step 7: Commit**

```bash
git add src/main/domain/ src/main/ports/ src/main/ipc/channels.ts
git commit -m "feat: add domain types, port interfaces, and IPC channel constants"
```

---

## Task 3: Adapters — FileSystem, Shell, Git, Tmux

**Files:**
- Create: `src/main/adapters/fs.adapter.ts`
- Create: `src/main/adapters/shell.adapter.ts`
- Create: `src/main/adapters/git.adapter.ts`
- Create: `src/main/adapters/tmux.adapter.ts`

- [ ] **Step 1: Create src/main/adapters/fs.adapter.ts**

```typescript
import {
  readFileSync,
  existsSync,
  readlinkSync,
  watch as fsWatch,
} from 'node:fs';
import { readFile, writeFile, mkdir, copyFile, cp } from 'node:fs/promises';
import type { FileSystemPort } from '../ports/filesystem.port';

export class FsAdapter implements FileSystemPort {
  async readFile(path: string): Promise<string> {
    return readFile(path, 'utf-8');
  }

  async writeFile(path: string, content: string): Promise<void> {
    await writeFile(path, content, 'utf-8');
  }

  exists(path: string): boolean {
    return existsSync(path);
  }

  async mkdir(path: string): Promise<void> {
    await mkdir(path, { recursive: true });
  }

  async copyFile(src: string, dest: string): Promise<void> {
    await copyFile(src, dest);
  }

  async copyRecursive(src: string, dest: string): Promise<void> {
    await cp(src, dest, { recursive: true });
  }

  readlink(path: string): string {
    return readlinkSync(path);
  }

  watch(path: string, opts: { recursive?: boolean }, cb: () => void): void {
    try {
      fsWatch(path, { persistent: false, recursive: opts.recursive ?? false }, cb);
    } catch {
      // Silently ignore watch errors (directory may not exist yet)
    }
  }
}
```

- [ ] **Step 2: Create src/main/adapters/shell.adapter.ts**

```typescript
import { execSync as nodeExecSync, exec as nodeExec } from 'node:child_process';
import type { ShellPort } from '../ports/shell.port';

export class ShellAdapter implements ShellPort {
  async exec(
    cmd: string,
    opts?: { cwd?: string; env?: Record<string, string>; timeout?: number },
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      nodeExec(
        cmd,
        {
          cwd: opts?.cwd,
          env: opts?.env ? { ...process.env, ...opts.env } : undefined,
          timeout: opts?.timeout ?? 30_000,
          encoding: 'utf-8',
        },
        (err, stdout) => {
          if (err) reject(err);
          else resolve(stdout.trim());
        },
      );
    });
  }

  execSync(
    cmd: string,
    opts?: { cwd?: string; encoding?: string; timeout?: number },
  ): string {
    return nodeExecSync(cmd, {
      cwd: opts?.cwd,
      encoding: (opts?.encoding as BufferEncoding) ?? 'utf-8',
      timeout: opts?.timeout ?? 30_000,
    }).trim();
  }
}
```

- [ ] **Step 3: Create src/main/adapters/git.adapter.ts**

```typescript
import { join } from 'node:path';
import type { GitPort } from '../ports/git.port';
import type { WorktreeEntry, BranchExistence, BranchInfo } from '../domain/types';
import type { ShellPort } from '../ports/shell.port';

export class GitAdapter implements GitPort {
  constructor(private shell: ShellPort) {}

  async getRepoRoot(cwd: string): Promise<string> {
    const gitCommon = await this.shell.exec(`git -C '${cwd}' rev-parse --git-common-dir`);
    if (gitCommon === '.git') {
      return this.shell.exec(`git -C '${cwd}' rev-parse --show-toplevel`);
    }
    const { dirname } = await import('node:path');
    return dirname(gitCommon);
  }

  getWorktreeDir(repoRoot: string): string {
    return join(repoRoot, '.worktrees');
  }

  async listWorktrees(
    repoRoot: string,
    wtDir: string,
    opts?: { includeMain?: boolean },
  ): Promise<WorktreeEntry[]> {
    const raw = await this.worktreeListPorcelain(repoRoot);
    const entries: WorktreeEntry[] = [];
    let current: Partial<WorktreeEntry> = {};

    for (const line of raw.split('\n')) {
      if (line.startsWith('worktree ')) {
        current = { path: line.slice(9) };
      } else if (line.startsWith('branch refs/heads/')) {
        current.branch = line.slice(18);
      } else if (line.startsWith('HEAD ')) {
        current.head = line.slice(5);
      } else if (line === '' && current.path) {
        const isMain = current.path === repoRoot;
        const isUnderWtDir = current.path.startsWith(wtDir);
        if (isUnderWtDir || (opts?.includeMain && isMain)) {
          entries.push({
            path: current.path,
            branch: current.branch ?? null,
            head: current.head ?? '',
          });
        }
        current = {};
      }
    }
    return entries;
  }

  async branchExists(repoRoot: string, branch: string): Promise<BranchExistence> {
    try {
      await this.shell.exec(
        `git -C '${repoRoot}' show-ref --verify --quiet refs/heads/${branch}`,
      );
      return 'local';
    } catch {
      // not local
    }
    try {
      await this.shell.exec(
        `git -C '${repoRoot}' show-ref --verify --quiet refs/remotes/origin/${branch}`,
      );
      return 'remote';
    } catch {
      return null;
    }
  }

  async listBranches(repoRoot: string): Promise<BranchInfo[]> {
    const localRaw = await this.shell.exec(
      `git -C '${repoRoot}' for-each-ref --format='%(refname:short)' refs/heads/`,
    ).catch(() => '');
    const remoteRaw = await this.shell.exec(
      `git -C '${repoRoot}' for-each-ref --format='%(refname:short)' refs/remotes/origin/`,
    ).catch(() => '');

    const locals = new Set(localRaw.split('\n').filter(Boolean));
    const remotes = new Set(
      remoteRaw
        .split('\n')
        .filter(Boolean)
        .map((r) => r.replace(/^origin\//, '')),
    );

    const allNames = new Set([...locals, ...remotes]);
    return [...allNames].map((name) => ({
      name,
      isLocal: locals.has(name),
      isRemote: remotes.has(name),
    }));
  }

  async isBranchMerged(repoRoot: string, branch: string, into: string): Promise<boolean> {
    try {
      const result = await this.shell.exec(`git -C '${repoRoot}' branch --merged ${into}`);
      return result.split('\n').some((line) => line.trim().replace(/^\* /, '') === branch);
    } catch {
      return false;
    }
  }

  async fetch(repoRoot: string, opts?: { prune?: boolean }): Promise<void> {
    const pruneFlag = opts?.prune ? ' --prune' : '';
    await this.shell.exec(`git -C '${repoRoot}' fetch origin --quiet${pruneFlag}`);
  }

  async worktreeAdd(
    repoRoot: string,
    path: string,
    branch: string,
    opts?: { newBranch?: boolean; base?: string },
  ): Promise<void> {
    if (opts?.newBranch && opts.base) {
      await this.shell.exec(`git -C '${repoRoot}' worktree add '${path}' -b '${branch}' '${opts.base}'`);
    } else {
      await this.shell.exec(`git -C '${repoRoot}' worktree add '${path}' '${branch}'`);
    }
  }

  async worktreeRemove(repoRoot: string, path: string): Promise<void> {
    await this.shell.exec(`git -C '${repoRoot}' worktree remove '${path}' --force`);
  }

  async worktreePrune(repoRoot: string): Promise<void> {
    await this.shell.exec(`git -C '${repoRoot}' worktree prune`);
  }

  async branchDelete(repoRoot: string, branch: string): Promise<void> {
    await this.shell.exec(`git -C '${repoRoot}' branch -d '${branch}'`);
  }

  async worktreeListPorcelain(repoRoot: string): Promise<string> {
    return this.shell.exec(`git -C '${repoRoot}' worktree list --porcelain`);
  }
}
```

- [ ] **Step 4: Create src/main/adapters/tmux.adapter.ts**

```typescript
import type { TmuxPort } from '../ports/tmux.port';
import type { ShellPort } from '../ports/shell.port';

export class TmuxAdapter implements TmuxPort {
  constructor(private shell: ShellPort) {}

  async exec(cmd: string): Promise<string> {
    try {
      return await this.shell.exec(`tmux ${cmd}`);
    } catch {
      return '';
    }
  }

  async listSessions(): Promise<string[]> {
    const raw = await this.exec("list-sessions -F '#{session_name}'");
    if (!raw) return [];
    return raw.split('\n').map((s) => s.replace(/'/g, '')).filter(Boolean);
  }

  async hasSession(session: string): Promise<boolean> {
    try {
      await this.shell.exec(`tmux has-session -t '${session}'`);
      return true;
    } catch {
      return false;
    }
  }

  async newSession(name: string, opts: { windowName: string; cwd: string }): Promise<void> {
    await this.exec(`new-session -d -s '${name}' -n '${opts.windowName}' -c '${opts.cwd}'`);
  }

  async killSession(session: string): Promise<void> {
    await this.exec(`kill-session -t '${session}'`);
  }

  async switchClient(tty: string, target: string): Promise<void> {
    await this.exec(`switch-client -c '${tty}' -t '${target}'`);
  }

  async newWindow(session: string, name: string, cwd: string): Promise<void> {
    await this.exec(`new-window -t '${session}' -n '${name}' -c '${cwd}'`);
  }

  async sendKeys(target: string, keys: string): Promise<void> {
    await this.exec(`send-keys -t '${target}' ${keys} Enter`);
  }

  async selectWindow(session: string, window: string): Promise<void> {
    await this.exec(`select-window -t '${session}':'${window}'`);
  }

  async listPanes(session: string): Promise<string> {
    return this.exec(`list-panes -t '${session}' -a -F '#{pane_id}\t#{window_name}\t#{pane_current_command}'`);
  }

  async capturePaneContent(paneId: string): Promise<string> {
    return this.exec(`capture-pane -t '${paneId}' -p`);
  }

  async displayMessage(target: string, format: string): Promise<string> {
    return this.exec(`display-message -t '${target}' -p '${format}'`);
  }
}
```

- [ ] **Step 5: Commit**

```bash
git add src/main/adapters/
git commit -m "feat: add fs, shell, git, and tmux adapters"
```

---

## Task 4: ConfigService + RegistryService

**Files:**
- Create: `src/main/services/config.service.ts`
- Create: `src/main/services/registry.service.ts`

- [ ] **Step 1: Create src/main/services/config.service.ts**

Port of `wt-lib/config.ts` with new `[clean]` section support.

```typescript
import { join } from 'node:path';
import type { FileSystemPort } from '../ports/filesystem.port';
import type { WtConfig } from '../domain/types';

function emptyConfig(): WtConfig {
  return {
    env: {},
    copy: [],
    install: '',
    base: '',
    hooks: {},
    tmux: [],
    cleanMergedInto: 'origin/staging',
  };
}

export class ConfigService {
  constructor(private fs: FileSystemPort) {}

  async parse(repoRoot: string): Promise<WtConfig> {
    const configPath = join(repoRoot, '.wt');
    const config = emptyConfig();

    let content: string;
    try {
      content = await this.fs.readFile(configPath);
    } catch {
      return config;
    }

    let section = '';

    for (const raw of content.split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;

      const sectionMatch = line.match(/^\[([a-z_]+)\]$/);
      if (sectionMatch) {
        section = sectionMatch[1];
        continue;
      }

      switch (section) {
        case 'env': {
          const eqIdx = line.indexOf('=');
          if (eqIdx > 0) {
            config.env[line.slice(0, eqIdx)] = line.slice(eqIdx + 1);
          }
          break;
        }
        case 'copy':
          config.copy.push(line);
          break;
        case 'install':
          if (line.startsWith('cmd=')) {
            config.install = line.slice(4);
          }
          break;
        case 'new':
          if (line.startsWith('base=')) {
            config.base = line.slice(5);
          }
          break;
        case 'hooks': {
          const eqIdx = line.indexOf('=');
          if (eqIdx > 0) {
            config.hooks[line.slice(0, eqIdx)] = line.slice(eqIdx + 1);
          }
          break;
        }
        case 'tmux':
          if (line.startsWith('window=')) {
            config.tmux.push(line.slice(7));
          }
          break;
        case 'clean':
          if (line.startsWith('merged_into=')) {
            config.cleanMergedInto = line.slice(12);
          }
          break;
      }
    }

    return config;
  }
}
```

- [ ] **Step 2: Create src/main/services/registry.service.ts**

```typescript
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { FileSystemPort } from '../ports/filesystem.port';

const REGISTRY_DIR = join(homedir(), '.local', 'share', 'wt');
const REGISTRY_PATH = join(REGISTRY_DIR, 'repos.json');

export class RegistryService {
  constructor(private fs: FileSystemPort) {}

  load(): Record<string, string> {
    try {
      // Sync read for simplicity — registry is small
      const { readFileSync } = require('node:fs');
      return JSON.parse(readFileSync(REGISTRY_PATH, 'utf-8'));
    } catch {
      return {};
    }
  }

  async save(name: string, rootPath: string): Promise<void> {
    const registry = this.load();
    if (registry[name] === rootPath) return;
    registry[name] = rootPath;
    await this.fs.mkdir(REGISTRY_DIR);
    await this.fs.writeFile(REGISTRY_PATH, JSON.stringify(registry, null, 2) + '\n');
  }

  async remove(name: string): Promise<void> {
    const registry = this.load();
    if (!(name in registry)) return;
    delete registry[name];
    await this.fs.mkdir(REGISTRY_DIR);
    await this.fs.writeFile(REGISTRY_PATH, JSON.stringify(registry, null, 2) + '\n');
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/main/services/config.service.ts src/main/services/registry.service.ts
git commit -m "feat: add config and registry services"
```

---

## Task 5: SessionService

**Files:**
- Create: `src/main/services/session.service.ts`

- [ ] **Step 1: Create src/main/services/session.service.ts**

Port of `wt-lib/tmux.ts` session lifecycle logic.

```typescript
import { basename } from 'node:path';
import type { TmuxPort } from '../ports/tmux.port';
import type { WtConfig } from '../domain/types';

export class SessionService {
  constructor(private tmux: TmuxPort) {}

  getSessionName(repoRoot: string, branch: string): string {
    return `${basename(repoRoot)}/${branch}`;
  }

  async launch(
    repoRoot: string,
    branch: string,
    workdir: string,
    config: WtConfig,
  ): Promise<string> {
    const session = this.getSessionName(repoRoot, branch);

    if (await this.tmux.hasSession(session)) {
      return session;
    }

    // Create session with Claude Code window
    await this.tmux.newSession(session, { windowName: 'Claude Code', cwd: workdir });
    await this.tmux.sendKeys(`${session}:Claude Code`, 'claude');

    // Default windows
    await this.tmux.newWindow(session, 'Git', workdir);
    await this.tmux.sendKeys(`${session}:Git`, 'lazygit');

    await this.tmux.newWindow(session, 'Shell', workdir);

    // Custom windows from .wt [tmux] config
    for (const entry of config.tmux) {
      const colonIdx = entry.indexOf(':');
      const name = colonIdx > -1 ? entry.slice(0, colonIdx) : entry;
      const cmd = colonIdx > -1 ? entry.slice(colonIdx + 1) : '';

      await this.tmux.newWindow(session, name, workdir);
      if (cmd) {
        await this.tmux.sendKeys(`${session}:${name}`, cmd);
      }
    }

    // Select first window
    await this.tmux.selectWindow(session, 'Claude Code');

    return session;
  }

  async kill(repoRoot: string, branch: string): Promise<void> {
    const session = this.getSessionName(repoRoot, branch);
    if (await this.tmux.hasSession(session)) {
      await this.tmux.killSession(session);
    }
  }

  async switchTo(session: string, tty: string): Promise<void> {
    await this.tmux.switchClient(tty, session);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/main/services/session.service.ts
git commit -m "feat: add session service for tmux lifecycle"
```

---

## Task 6: ThemeService

**Files:**
- Create: `src/main/services/theme.service.ts`

- [ ] **Step 1: Create src/main/services/theme.service.ts**

Port of theme loading logic from original `main.js`.

```typescript
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { FileSystemPort } from '../ports/filesystem.port';
import type { ThemeColors } from '../domain/types';

const THEME_DIR = join(homedir(), '.config/omarchy/current/theme');
const COLORS_TOML = join(THEME_DIR, 'colors.toml');
const GHOSTTY_CONF = join(THEME_DIR, 'ghostty.conf');

const FALLBACK_THEME: ThemeColors = {
  accent: '#7daea3', cursor: '#bdae93', foreground: '#d4be98',
  background: '#282828', selection_foreground: '#ebdbb2',
  selection_background: '#d65d0e',
  color0: '#3c3836', color1: '#ea6962', color2: '#a9b665',
  color3: '#d8a657', color4: '#7daea3', color5: '#d3869b',
  color6: '#89b482', color7: '#d4be98', color8: '#3c3836',
  color9: '#ea6962', color10: '#a9b665', color11: '#d8a657',
  color12: '#7daea3', color13: '#d3869b', color14: '#89b482',
  color15: '#d4be98',
};

export class ThemeService {
  private lastJson = '';
  private listener: ((colors: ThemeColors) => void) | null = null;

  constructor(private fs: FileSystemPort) {}

  load(): ThemeColors {
    // Try colors.toml first
    try {
      const raw = require('node:fs').readFileSync(COLORS_TOML, 'utf-8');
      const colors: ThemeColors = {};
      for (const line of raw.split('\n')) {
        const m = line.match(/^(\w+)\s*=\s*"([^"]+)"/);
        if (m) colors[m[1]] = m[2];
      }
      if (Object.keys(colors).length > 0) return colors;
    } catch {}

    // Fall back to ghostty.conf
    try {
      const raw = require('node:fs').readFileSync(GHOSTTY_CONF, 'utf-8');
      const colors: ThemeColors = {};
      for (const line of raw.split('\n')) {
        const m = line.match(/^(\S+)\s*=\s*(.+)/);
        if (!m) continue;
        const [, key, val] = m;
        const v = val.trim();
        if (key === 'background') colors.background = v;
        else if (key === 'foreground') colors.foreground = v;
        else if (key === 'cursor-color') colors.cursor = v;
        else if (key === 'selection-background') colors.selection_background = v;
        else if (key === 'selection-foreground') colors.selection_foreground = v;
        else if (key.startsWith('palette')) {
          const pm = v.match(/^(\d+)=(#\w+)/);
          if (pm) colors[`color${pm[1]}`] = pm[2];
        }
      }
      if (!colors.accent) colors.accent = colors.color4 || '#7daea3';
      if (Object.keys(colors).length > 0) return colors;
    } catch {}

    return { ...FALLBACK_THEME };
  }

  onChange(listener: (colors: ThemeColors) => void): void {
    this.listener = listener;
  }

  sendIfChanged(): void {
    const colors = this.load();
    const json = JSON.stringify(colors);
    if (json !== this.lastJson) {
      this.lastJson = json;
      this.listener?.(colors);
    }
  }

  startWatching(): void {
    this.lastJson = JSON.stringify(this.load());

    this.fs.watch(THEME_DIR, { recursive: true }, () => {
      setTimeout(() => this.sendIfChanged(), 300);
    });

    // Watch parent dir to catch theme dir replacement
    const { dirname } = require('node:path');
    this.fs.watch(dirname(THEME_DIR), {}, () => {
      setTimeout(() => this.sendIfChanged(), 300);
    });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/main/services/theme.service.ts
git commit -m "feat: add theme service for Omarchy/Ghostty theme loading"
```

---

## Task 7: StateService (with Claude Status Detection)

**Files:**
- Create: `src/main/services/state.service.ts`

- [ ] **Step 1: Create src/main/services/state.service.ts**

Port of `collectState()` and `detectClaudeStatus()` from original `main.js`.

```typescript
import type { GitPort } from '../ports/git.port';
import type { TmuxPort } from '../ports/tmux.port';
import type { RegistryService } from './registry.service';
import type { AppState, SessionEntry, ClaudeStatus } from '../domain/types';

export class StateService {
  private prevPaneContent: Record<string, string> = {};
  private listener: ((state: AppState) => void) | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private git: GitPort,
    private tmux: TmuxPort,
    private registry: RegistryService,
  ) {}

  onChange(listener: (state: AppState) => void): void {
    this.listener = listener;
  }

  startPolling(intervalMs = 5000): void {
    this.timer = setInterval(async () => {
      const state = await this.collect();
      this.listener?.(state);
    }, intervalMs);
  }

  stopPolling(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async collect(): Promise<AppState> {
    const entries: SessionEntry[] = [];
    const repoSet = new Map<string, string>();

    // Load persisted repos from registry
    const registry = this.registry.load();
    for (const [name, rootPath] of Object.entries(registry)) {
      const { existsSync } = require('node:fs');
      if (existsSync(rootPath)) {
        repoSet.set(name, rootPath);
      }
    }

    // Discover repos from active tmux sessions
    const sessions = await this.tmux.listSessions();

    for (const trimmed of sessions) {
      if (trimmed.startsWith('_wt_')) continue;

      const slashIdx = trimmed.indexOf('/');
      if (slashIdx === -1) {
        entries.push({
          repo: 'standalone',
          branch: trimmed,
          tmuxSession: trimmed,
          status: 'none',
          worktreePath: null,
          isMainWorktree: false,
        });
      } else {
        const repo = trimmed.slice(0, slashIdx);
        const branch = trimmed.slice(slashIdx + 1);
        const status = await this.detectClaudeStatus(trimmed);
        entries.push({ repo, branch, tmuxSession: trimmed, status, worktreePath: null, isMainWorktree: false });

        if (!repoSet.has(repo)) {
          try {
            const panePath = await this.tmux.displayMessage(trimmed, '#{pane_current_path}');
            if (panePath) {
              const root = await this.git.getRepoRoot(panePath);
              if (root) {
                repoSet.set(repo, root);
                await this.registry.save(repo, root);
              }
            }
          } catch {}
        }
      }
    }

    // Find orphaned worktrees (including main worktree)
    const activeNames = new Set(entries.map((e) => e.tmuxSession));
    for (const [repoName, repoRoot] of repoSet) {
      try {
        const wtDir = this.git.getWorktreeDir(repoRoot);
        const raw = await this.git.worktreeListPorcelain(repoRoot);
        let curPath = '';
        let curBranch: string | null = null;

        for (const line of raw.split('\n')) {
          if (line.startsWith('worktree ')) {
            curPath = line.slice(9);
            curBranch = null;
          } else if (line.startsWith('branch refs/heads/')) {
            curBranch = line.slice(18);
          } else if (line === '' && curPath) {
            const isMain = curPath === repoRoot;
            const isUnderWtDir = curPath.startsWith(wtDir);

            if ((isUnderWtDir || isMain) && curBranch) {
              const sessionName = `${repoName}/${curBranch}`;
              if (!activeNames.has(sessionName)) {
                entries.push({
                  repo: repoName,
                  branch: curBranch,
                  tmuxSession: null,
                  status: 'none',
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
            curPath = '';
            curBranch = null;
          }
        }
      } catch {}
    }

    return { entries, repos: [...repoSet.entries()] };
  }

  private async detectClaudeStatus(session: string): Promise<ClaudeStatus> {
    const panes = await this.tmux.listPanes(session);
    if (!panes) return 'none';

    let claudePaneId: string | null = null;
    for (const line of panes.split('\n')) {
      const [id, winName, cmd] = line.split('\t');
      if (winName === 'Claude Code' && cmd === 'claude') {
        claudePaneId = id;
        break;
      }
    }
    if (!claudePaneId) return 'none';

    const content = await this.tmux.capturePaneContent(claudePaneId);
    if (!content) return 'none';

    const lines = content.split('\n').filter((l) => l.trim().length > 0);
    const tail = lines.slice(-10);
    const tailStr = tail.join('\n');

    // Tool approval prompts = needs user input
    if (/\(y\s*=\s*yes|Allow|Approve|Do you want/.test(tailStr)) return 'action';

    // Spinner line
    for (const line of tail) {
      const t = line.trim();
      if (/^[✶·✢✻✹*]/.test(t)) {
        const parenMatch = t.match(/\(([^)]+)\)\s*$/);
        if (parenMatch) {
          const inside = parenMatch[1];
          if (/ing\b/.test(inside)) return 'busy';
          if (/for \d/.test(inside)) return 'done';
        }
      }
      if (/⎿\s+\S.*ing/.test(t)) return 'busy';
    }

    // Compare output area — if content changed since last poll, busy
    const outputArea = lines.slice(0, -6).join('\n');
    const prev = this.prevPaneContent[claudePaneId];
    this.prevPaneContent[claudePaneId] = outputArea;

    if (prev !== undefined && prev !== outputArea) return 'busy';

    return 'done';
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/main/services/state.service.ts
git commit -m "feat: add state service with claude status detection"
```

---

## Task 8: WorktreeService

**Files:**
- Create: `src/main/services/worktree.service.ts`

- [ ] **Step 1: Create src/main/services/worktree.service.ts**

Port of `wt-lib/commands/new.ts`, `rm.ts`, and `clean.ts`.

```typescript
import { join, dirname } from 'node:path';
import type { GitPort } from '../ports/git.port';
import type { FileSystemPort } from '../ports/filesystem.port';
import type { ShellPort } from '../ports/shell.port';
import type { ConfigService } from './config.service';
import type { SessionService } from './session.service';
import type { RegistryService } from './registry.service';
import type {
  CreateWorktreeParams,
  CleanCandidate,
  CleanTarget,
  CleanReport,
} from '../domain/types';

export class WorktreeService {
  constructor(
    private git: GitPort,
    private fs: FileSystemPort,
    private shell: ShellPort,
    private config: ConfigService,
    private session: SessionService,
    private registry: RegistryService,
  ) {}

  async create(params: CreateWorktreeParams): Promise<void> {
    const { repoRoot, branch, base, install } = params;
    const wtDir = this.git.getWorktreeDir(repoRoot);
    const wtPath = join(wtDir, branch);
    const config = await this.config.parse(repoRoot);

    if (this.fs.exists(wtPath)) {
      throw new Error(`Worktree already exists at ${wtPath}`);
    }

    await this.fs.mkdir(wtDir);

    // Check if branch already exists
    const exists = await this.git.branchExists(repoRoot, branch);

    if (exists) {
      await this.git.worktreeAdd(repoRoot, wtPath, branch);
    } else {
      const baseRef = base || config.base || 'origin/main';
      await this.git.fetch(repoRoot);
      await this.git.worktreeAdd(repoRoot, wtPath, branch, { newBranch: true, base: baseRef });
    }

    // pre_new hook
    await this.runHook(config.hooks.pre_new, branch, wtPath, repoRoot);

    // Copy .claude/settings.local.json
    const settingsSrc = join(repoRoot, '.claude', 'settings.local.json');
    if (this.fs.exists(settingsSrc)) {
      await this.fs.mkdir(join(wtPath, '.claude'));
      await this.fs.copyFile(settingsSrc, join(wtPath, '.claude', 'settings.local.json'));
    }

    // .env handling
    const envKeys = Object.keys(config.env);
    if (envKeys.length > 0) {
      const envContent = envKeys.map((k) => `${k}=${config.env[k]}`).join('\n') + '\n';
      await this.fs.writeFile(join(wtPath, '.env'), envContent);
    } else if (this.fs.exists(join(repoRoot, '.env'))) {
      await this.fs.copyFile(join(repoRoot, '.env'), join(wtPath, '.env'));
    }

    // [copy] section
    for (const relPath of config.copy) {
      const src = join(repoRoot, relPath);
      const dst = join(wtPath, relPath);
      if (this.fs.exists(src)) {
        await this.fs.mkdir(dirname(dst));
        await this.fs.copyRecursive(src, dst);
      }
    }

    // [install] section
    if (install && config.install) {
      await this.shell.exec(`sh -c '${config.install}'`, { cwd: wtPath });
    }

    // post_new hook
    await this.runHook(config.hooks.post_new, branch, wtPath, repoRoot);

    // Launch tmux session
    await this.session.launch(repoRoot, branch, wtPath, config);
  }

  async remove(repoRoot: string, branch: string, deleteBranch: boolean): Promise<void> {
    const wtDir = this.git.getWorktreeDir(repoRoot);
    const wtPath = join(wtDir, branch);
    const config = await this.config.parse(repoRoot);

    // pre_rm hook
    await this.runHook(config.hooks.pre_rm, branch, wtPath, repoRoot);

    // Remove worktree
    await this.git.worktreeRemove(repoRoot, wtPath);

    // Kill tmux session
    await this.session.kill(repoRoot, branch);

    // Optionally delete branch
    if (deleteBranch) {
      try {
        await this.git.branchDelete(repoRoot, branch);
      } catch {
        // Branch may already be deleted or not exist
      }
    }

    // post_rm hook
    await this.runHook(config.hooks.post_rm, branch, wtPath, repoRoot);
  }

  async getCleanCandidates(): Promise<CleanCandidate[]> {
    const candidates: CleanCandidate[] = [];
    const registry = this.registry.load();

    for (const [repoName, repoRoot] of Object.entries(registry)) {
      if (!this.fs.exists(repoRoot)) continue;

      try {
        const config = await this.config.parse(repoRoot);
        const mergedInto = config.cleanMergedInto;

        await this.git.fetch(repoRoot, { prune: true });

        const wtDir = this.git.getWorktreeDir(repoRoot);
        const entries = await this.git.listWorktrees(repoRoot, wtDir);

        for (const entry of entries) {
          const branch = entry.branch;
          if (!branch) continue;

          // Check if merged
          if (await this.git.isBranchMerged(repoRoot, branch, mergedInto)) {
            candidates.push({
              repo: repoName,
              repoRoot,
              branch,
              worktreePath: entry.path,
              reason: 'merged',
            });
            continue;
          }

          // Check if remote branch deleted
          const existence = await this.git.branchExists(repoRoot, branch);
          if (existence === 'local') {
            // Local exists but let's check if remote is gone
            try {
              await this.shell.exec(
                `git -C '${repoRoot}' show-ref --verify --quiet refs/remotes/origin/${branch}`,
              );
            } catch {
              candidates.push({
                repo: repoName,
                repoRoot,
                branch,
                worktreePath: entry.path,
                reason: 'remote-deleted',
              });
            }
          }
        }
      } catch {
        // Skip repos with errors
      }
    }

    return candidates;
  }

  async clean(targets: CleanTarget[]): Promise<CleanReport> {
    const report: CleanReport = { removed: 0, errors: [] };

    // Group by repoRoot for hook calls
    const byRepo = new Map<string, CleanTarget[]>();
    for (const t of targets) {
      const group = byRepo.get(t.repoRoot) ?? [];
      group.push(t);
      byRepo.set(t.repoRoot, group);
    }

    for (const [repoRoot, repoTargets] of byRepo) {
      const config = await this.config.parse(repoRoot);

      // pre_clean hook
      await this.runHook(config.hooks.pre_clean, '', repoRoot, repoRoot);

      for (const target of repoTargets) {
        try {
          await this.git.worktreeRemove(repoRoot, target.worktreePath);

          // Kill tmux session
          const { basename } = require('node:path');
          await this.session.kill(repoRoot, target.branch);

          // Delete branch if requested
          if (target.deleteBranch) {
            try {
              await this.git.branchDelete(repoRoot, target.branch);
            } catch {}
          }

          report.removed++;
        } catch (err) {
          report.errors.push(`${target.branch}: ${(err as Error).message}`);
        }
      }

      // Prune
      await this.git.worktreePrune(repoRoot);

      // post_clean hook
      await this.runHook(config.hooks.post_clean, '', repoRoot, repoRoot);
    }

    return report;
  }

  private async runHook(
    cmd: string | undefined,
    branch: string,
    wtPath: string,
    repoRoot: string,
  ): Promise<void> {
    if (!cmd) return;
    const cwd = this.fs.exists(wtPath) ? wtPath : repoRoot;
    try {
      await this.shell.exec(`sh -c '${cmd}'`, {
        cwd,
        env: { ...process.env, WT_BRANCH: branch, WT_PATH: wtPath },
      });
    } catch (err) {
      // pre_ hooks abort, post_ hooks warn
      if (cmd.includes('pre_')) {
        throw new Error(`Hook failed: ${(err as Error).message}`);
      }
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/main/services/worktree.service.ts
git commit -m "feat: add worktree service replacing wt CLI"
```

---

## Task 9: IPC Handlers + Preload Bridge

**Files:**
- Create: `src/main/ipc/handlers.ts`
- Create: `src/preload/index.ts`
- Create: `src/preload/api.d.ts`

- [ ] **Step 1: Create src/main/ipc/handlers.ts**

```typescript
import { ipcMain } from 'electron';
import { Channels } from './channels';
import type { WorktreeService } from '../services/worktree.service';
import type { SessionService } from '../services/session.service';
import type { StateService } from '../services/state.service';
import type { ThemeService } from '../services/theme.service';
import type { RegistryService } from '../services/registry.service';
import type { ConfigService } from '../services/config.service';
import type { GitPort } from '../ports/git.port';
import type { TmuxPort } from '../ports/tmux.port';
import type { CreateWorktreeParams, CleanTarget, Result } from '../domain/types';

function ok<T>(data: T): Result<T> {
  return { success: true, data };
}

function err(message: string): Result<never> {
  return { success: false, error: message };
}

export function registerHandlers(deps: {
  worktreeService: WorktreeService;
  sessionService: SessionService;
  stateService: StateService;
  themeService: ThemeService;
  registryService: RegistryService;
  configService: ConfigService;
  tmux: TmuxPort;
  git: GitPort;
  getPtyClientTty: () => string | null;
}): void {
  const { worktreeService, sessionService, stateService, themeService, registryService, configService, tmux, git, getPtyClientTty } = deps;

  // ── Queries ──────────────────────────────────────────────────
  ipcMain.handle(Channels.GET_STATE, async () => {
    return stateService.collect();
  });

  ipcMain.handle(Channels.GET_THEME, () => {
    return themeService.load();
  });

  ipcMain.handle(Channels.GET_BRANCHES, async (_event, repoRoot: string) => {
    return git.listBranches(repoRoot);
  });

  ipcMain.handle(Channels.GET_CLEAN_CANDIDATES, async () => {
    return worktreeService.getCleanCandidates();
  });

  // ── Commands ─────────────────────────────────────────────────
  ipcMain.handle(Channels.SWITCH_SESSION, async (_event, session: string) => {
    try {
      const tty = getPtyClientTty();
      if (!tty) return err('No PTY client TTY available');
      await sessionService.switchTo(session, tty);
      return ok(undefined);
    } catch (e) {
      return err((e as Error).message);
    }
  });

  ipcMain.handle(Channels.KILL_SESSION, async (_event, session: string) => {
    try {
      await tmux.killSession(session);
      return ok(undefined);
    } catch (e) {
      return err((e as Error).message);
    }
  });

  ipcMain.handle(Channels.CREATE_SESSION, async (_event, name: string) => {
    try {
      await tmux.newSession(name, { windowName: 'Shell', cwd: process.env.HOME! });
      const tty = getPtyClientTty();
      if (tty) await sessionService.switchTo(name, tty);
      return ok(undefined);
    } catch (e) {
      return err((e as Error).message);
    }
  });

  ipcMain.handle(Channels.START_SESSION, async (_event, session: string, workdir: string) => {
    try {
      const slashIdx = session.indexOf('/');
      if (slashIdx === -1) return err('Invalid session name');
      const repo = session.slice(0, slashIdx);
      const branch = session.slice(slashIdx + 1);

      const registry = registryService.load();
      const repoRoot = registry[repo];
      if (!repoRoot) return err(`Repo '${repo}' not found in registry`);

      const config = await configService.parse(repoRoot);
      await sessionService.launch(repoRoot, branch, workdir, config);

      const tty = getPtyClientTty();
      if (tty) await sessionService.switchTo(session, tty);
      return ok(undefined);
    } catch (e) {
      return err((e as Error).message);
    }
  });

  ipcMain.handle(Channels.CREATE_WORKTREE, async (_event, params: CreateWorktreeParams) => {
    try {
      await worktreeService.create(params);
      return ok(undefined);
    } catch (e) {
      return err((e as Error).message);
    }
  });

  ipcMain.handle(Channels.REMOVE_WORKTREE, async (_event, repoRoot: string, branch: string, deleteBranch: boolean) => {
    try {
      await worktreeService.remove(repoRoot, branch, deleteBranch);
      return ok(undefined);
    } catch (e) {
      return err((e as Error).message);
    }
  });

  ipcMain.handle(Channels.CLEAN_WORKTREES, async (_event, items: CleanTarget[]) => {
    try {
      const report = await worktreeService.clean(items);
      return ok(report);
    } catch (e) {
      return err((e as Error).message);
    }
  });

  ipcMain.handle(Channels.REMOVE_REPO, async (_event, repoName: string) => {
    try {
      await registryService.remove(repoName);
      return ok(undefined);
    } catch (e) {
      return err((e as Error).message);
    }
  });
}
```

- [ ] **Step 2: Create src/preload/index.ts**

```typescript
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
  // PTY
  onPtyData: (cb: (data: string) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, data: string) => cb(data);
    ipcRenderer.on('pty-data', handler);
    return () => ipcRenderer.removeListener('pty-data', handler);
  },
  sendPtyInput: (data: string) => ipcRenderer.send('pty-input', data),
  sendPtyResize: (cols: number, rows: number) => ipcRenderer.send('pty-resize', { cols, rows }),

  // State
  getState: () => ipcRenderer.invoke('get-state'),
  onStateUpdate: (cb: (state: any) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, state: any) => cb(state);
    ipcRenderer.on('state-update', handler);
    return () => ipcRenderer.removeListener('state-update', handler);
  },

  // Actions
  switchSession: (session: string) => ipcRenderer.invoke('switch-session', session),
  killSession: (session: string) => ipcRenderer.invoke('kill-session', session),
  createSession: (name: string) => ipcRenderer.invoke('create-session', name),
  startSession: (session: string, workdir: string) => ipcRenderer.invoke('start-session', session, workdir),
  createWorktree: (params: any) => ipcRenderer.invoke('create-worktree', params),
  removeWorktree: (repoRoot: string, branch: string, deleteBranch: boolean) =>
    ipcRenderer.invoke('remove-worktree', repoRoot, branch, deleteBranch),
  cleanWorktrees: (items: any[]) => ipcRenderer.invoke('clean-worktrees', items),
  removeRepo: (repoName: string) => ipcRenderer.invoke('remove-repo', repoName),
  getBranches: (repoRoot: string) => ipcRenderer.invoke('get-branches', repoRoot),
  getCleanCandidates: () => ipcRenderer.invoke('get-clean-candidates'),

  // Theme
  getTheme: () => ipcRenderer.invoke('get-theme'),
  onThemeUpdate: (cb: (colors: any) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, colors: any) => cb(colors);
    ipcRenderer.on('theme-update', handler);
    return () => ipcRenderer.removeListener('theme-update', handler);
  },
});
```

- [ ] **Step 3: Create src/preload/api.d.ts**

```typescript
import type {
  AppState,
  ThemeColors,
  BranchInfo,
  CreateWorktreeParams,
  CleanCandidate,
  CleanTarget,
  CleanReport,
  Result,
} from '../main/domain/types';

interface ElectronAPI {
  // PTY
  onPtyData: (cb: (data: string) => void) => () => void;
  sendPtyInput: (data: string) => void;
  sendPtyResize: (cols: number, rows: number) => void;

  // State
  getState: () => Promise<AppState>;
  onStateUpdate: (cb: (state: AppState) => void) => () => void;

  // Actions
  switchSession: (session: string) => Promise<Result<void>>;
  killSession: (session: string) => Promise<Result<void>>;
  createSession: (name: string) => Promise<Result<void>>;
  startSession: (session: string, workdir: string) => Promise<Result<void>>;
  createWorktree: (params: CreateWorktreeParams) => Promise<Result<void>>;
  removeWorktree: (repoRoot: string, branch: string, deleteBranch: boolean) => Promise<Result<void>>;
  cleanWorktrees: (items: CleanTarget[]) => Promise<Result<CleanReport>>;
  removeRepo: (repoName: string) => Promise<Result<void>>;
  getBranches: (repoRoot: string) => Promise<BranchInfo[]>;
  getCleanCandidates: () => Promise<CleanCandidate[]>;

  // Theme
  getTheme: () => Promise<ThemeColors>;
  onThemeUpdate: (cb: (colors: ThemeColors) => void) => () => void;
}

declare global {
  interface Window {
    api: ElectronAPI;
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add src/main/ipc/handlers.ts src/preload/
git commit -m "feat: add IPC handlers and typed preload bridge"
```

---

## Task 10: Main Process Entry Point

**Files:**
- Create: `src/main/index.ts`
- Delete: `main.js`, `preload.js`

- [ ] **Step 1: Create src/main/index.ts**

```typescript
import { app, BrowserWindow, ipcMain, Menu } from 'electron';
import * as pty from 'node-pty';
import path from 'node:path';

import { FsAdapter } from './adapters/fs.adapter';
import { ShellAdapter } from './adapters/shell.adapter';
import { GitAdapter } from './adapters/git.adapter';
import { TmuxAdapter } from './adapters/tmux.adapter';

import { ConfigService } from './services/config.service';
import { RegistryService } from './services/registry.service';
import { SessionService } from './services/session.service';
import { ThemeService } from './services/theme.service';
import { StateService } from './services/state.service';
import { WorktreeService } from './services/worktree.service';

import { registerHandlers } from './ipc/handlers';
import { Channels } from './ipc/channels';

let mainWindow: BrowserWindow | null = null;
let ptyProcess: pty.IPty | null = null;

// ── Adapters ──────────────────────────────────────────────────────
const fsAdapter = new FsAdapter();
const shellAdapter = new ShellAdapter();
const gitAdapter = new GitAdapter(shellAdapter);
const tmuxAdapter = new TmuxAdapter(shellAdapter);

// ── Services ──────────────────────────────────────────────────────
const configService = new ConfigService(fsAdapter);
const registryService = new RegistryService(fsAdapter);
const sessionService = new SessionService(tmuxAdapter);
const themeService = new ThemeService(fsAdapter);
const stateService = new StateService(gitAdapter, tmuxAdapter, registryService);
const worktreeService = new WorktreeService(
  gitAdapter, fsAdapter, shellAdapter, configService, sessionService, registryService,
);

// ── PTY ───────────────────────────────────────────────────────────
function getPtyClientTty(): string | null {
  if (!ptyProcess) return null;
  try {
    return fsAdapter.readlink(`/proc/${ptyProcess.pid}/fd/0`);
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
    const sessions = shellAdapter.execSync('tmux list-sessions -F "#{session_name}"', {}).catch?.(() => '');
    // Sync check for remaining sessions
    try {
      const s = require('node:child_process').execSync('tmux list-sessions -F "#{session_name}"', { encoding: 'utf-8' });
      if (s.trim()) {
        startPty(cols, rows);
      } else {
        app.quit();
      }
    } catch {
      app.quit();
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
    registryService,
    configService,
    tmux: tmuxAdapter,
    git: gitAdapter,
    getPtyClientTty,
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
  stateService.startPolling(5000);
});

app.on('window-all-closed', () => {
  stateService.stopPolling();
  ptyProcess?.kill();
  app.quit();
});
```

- [ ] **Step 2: Delete old entry files**

```bash
rm main.js preload.js
```

- [ ] **Step 3: Commit**

```bash
git add src/main/index.ts
git rm main.js preload.js
git commit -m "feat: add main process entry with DI wiring, remove old files"
```

---

## Task 11: React + Tailwind + shadcn/ui Setup

**Files:**
- Create: `src/renderer/index.html`
- Create: `src/renderer/main.tsx`
- Create: `src/renderer/styles/globals.css`
- Create: `src/renderer/lib/utils.ts`
- Delete: `index.html`, `styles.css`, `src/renderer.ts`

- [ ] **Step 1: Initialize shadcn/ui with Base UI**

```bash
npx shadcn@latest init --base-ui
```

When prompted, select defaults. This creates `components.json` at project root. If the interactive prompt doesn't work in this context, create it manually in step 2.

- [ ] **Step 2: Create components.json (if not created by init)**

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "default",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "src/renderer/styles/globals.css",
    "baseColor": "neutral",
    "cssVariables": true
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  },
  "iconLibrary": "lucide"
}
```

- [ ] **Step 3: Create src/renderer/styles/globals.css**

```css
@import "tailwindcss";

@theme {
  --color-bg: var(--bg, #282828);
  --color-fg: var(--fg, #d4be98);
  --color-accent: var(--accent, #7daea3);
  --color-cursor: var(--cursor, #bdae93);
  --color-sel-fg: var(--sel-fg, #ebdbb2);
  --color-sel-bg: var(--sel-bg, #d65d0e);
  --color-c0: var(--c0, #3c3836);
  --color-c1: var(--c1, #ea6962);
  --color-c2: var(--c2, #a9b665);
  --color-c3: var(--c3, #d8a657);
  --color-c4: var(--c4, #7daea3);
  --color-c5: var(--c5, #d3869b);
  --color-c6: var(--c6, #89b482);
  --color-c7: var(--c7, #d4be98);
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  background: var(--bg, #282828);
  color: var(--fg, #d4be98);
  font-family: "JetBrainsMono Nerd Font", "JetBrains Mono", "Fira Code", monospace;
  font-size: 13px;
  overflow: hidden;
  height: 100vh;
}

/* Scrollbar */
::-webkit-scrollbar { width: 4px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--c0, #3c3836); border-radius: 2px; }
```

- [ ] **Step 4: Create src/renderer/lib/utils.ts**

```typescript
import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 5: Install shadcn utility deps**

```bash
npm install clsx tailwind-merge
```

- [ ] **Step 6: Create src/renderer/index.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Gustav</title>
  <link rel="stylesheet" href="../../node_modules/@xterm/xterm/css/xterm.css">
</head>
<body>
  <div id="root"></div>
  <script type="module" src="./main.tsx"></script>
</body>
</html>
```

- [ ] **Step 7: Create src/renderer/main.tsx**

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/globals.css';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 8: Create src/renderer/App.tsx (minimal shell)**

```tsx
export function App() {
  return (
    <div className="flex h-screen">
      <aside className="w-[220px] min-w-[220px] bg-bg flex flex-col py-2 overflow-y-auto">
        <div className="flex-1 p-3 text-fg/50">Sidebar loading...</div>
      </aside>
      <div className="w-1 cursor-col-resize bg-c0" />
      <main className="flex-1 bg-bg overflow-hidden">
        <div className="p-4 text-fg/50">Terminal loading...</div>
      </main>
    </div>
  );
}
```

- [ ] **Step 9: Delete old renderer files**

```bash
rm index.html styles.css src/renderer.ts
```

- [ ] **Step 10: Verify build compiles**

```bash
npx electron-vite build
```

Expected: builds without errors to `out/` directory.

- [ ] **Step 11: Commit**

```bash
git add src/renderer/ components.json src/renderer/lib/ src/renderer/styles/
git rm index.html styles.css src/renderer.ts
git commit -m "feat: add React renderer with Tailwind and shadcn/ui setup"
```

---

## Task 12: Zustand Store + Hooks

**Files:**
- Create: `src/renderer/hooks/use-app-state.ts`
- Create: `src/renderer/hooks/use-theme.ts`
- Create: `src/renderer/hooks/use-terminal.ts`

- [ ] **Step 1: Create src/renderer/hooks/use-app-state.ts**

```typescript
import { create } from 'zustand';
import { useEffect } from 'react';
import type { SessionEntry } from '../../main/domain/types';

interface AppStore {
  entries: SessionEntry[];
  repos: Map<string, string>;
  activeSession: string | null;
  setEntries: (entries: SessionEntry[]) => void;
  setRepos: (repos: [string, string][]) => void;
  setActiveSession: (session: string | null) => void;
}

export const useAppStore = create<AppStore>((set) => ({
  entries: [],
  repos: new Map(),
  activeSession: null,
  setEntries: (entries) => set({ entries }),
  setRepos: (repos) => set({ repos: new Map(repos) }),
  setActiveSession: (activeSession) => set({ activeSession }),
}));

export function useAppStateSubscription() {
  const { setEntries, setRepos } = useAppStore();

  useEffect(() => {
    // Initial fetch
    window.api.getState().then((state) => {
      setRepos(state.repos);
      setEntries(state.entries);

      // Set initial active session
      const first = state.entries.find((e) => e.tmuxSession && e.repo !== 'standalone');
      if (first?.tmuxSession) {
        useAppStore.getState().setActiveSession(first.tmuxSession);
      }
    });

    // Subscribe to updates
    const cleanup = window.api.onStateUpdate((state) => {
      setRepos(state.repos);
      setEntries(state.entries);
    });

    return cleanup;
  }, [setEntries, setRepos]);
}

export async function refreshState() {
  const state = await window.api.getState();
  useAppStore.getState().setRepos(state.repos);
  useAppStore.getState().setEntries(state.entries);
}
```

- [ ] **Step 2: Create src/renderer/hooks/use-theme.ts**

```typescript
import { useEffect } from 'react';
import type { ThemeColors } from '../../main/domain/types';

function applyThemeToDOM(c: ThemeColors) {
  const r = document.documentElement.style;
  r.setProperty('--bg', c.background || '#282828');
  r.setProperty('--fg', c.foreground || '#d4be98');
  r.setProperty('--accent', c.accent || '#7daea3');
  r.setProperty('--cursor', c.cursor || '#bdae93');
  r.setProperty('--sel-fg', c.selection_foreground || '#ebdbb2');
  r.setProperty('--sel-bg', c.selection_background || '#d65d0e');
  for (let i = 0; i <= 15; i++) {
    r.setProperty(`--c${i}`, c[`color${i}`] || '');
  }
}

export function xtermTheme(c: ThemeColors) {
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

export function useTheme() {
  useEffect(() => {
    // Initial theme
    window.api.getTheme().then(applyThemeToDOM);

    // Subscribe to updates
    const cleanup = window.api.onThemeUpdate(applyThemeToDOM);
    return cleanup;
  }, []);
}
```

- [ ] **Step 3: Create src/renderer/hooks/use-terminal.ts**

```typescript
import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { xtermTheme } from './use-theme';

export function useTerminal(containerRef: React.RefObject<HTMLDivElement | null>) {
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontFamily: '"JetBrainsMono Nerd Font", "JetBrains Mono", "Fira Code", monospace',
      fontSize: 13,
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);

    termRef.current = term;
    fitRef.current = fitAddon;

    function fit() {
      fitAddon.fit();
      window.api.sendPtyResize(term.cols, term.rows);
    }

    setTimeout(fit, 100);
    const resizeObserver = new ResizeObserver(() => fit());
    resizeObserver.observe(containerRef.current);

    // PTY data
    const cleanupPty = window.api.onPtyData((data) => term.write(data));

    // Custom key handler: Shift+Enter
    term.attachCustomKeyEventHandler((event) => {
      if (event.key === 'Enter' && event.shiftKey) {
        if (event.type === 'keydown') window.api.sendPtyInput('\x1b[13;2u');
        return false;
      }
      return true;
    });

    // Input relay
    term.onData((data) => window.api.sendPtyInput(data));

    // Theme updates
    window.api.getTheme().then((colors) => {
      term.options.theme = xtermTheme(colors);
    });
    const cleanupTheme = window.api.onThemeUpdate((colors) => {
      term.options.theme = xtermTheme(colors);
    });

    term.focus();

    return () => {
      cleanupPty();
      cleanupTheme();
      resizeObserver.disconnect();
      term.dispose();
    };
  }, [containerRef]);

  return { termRef, fitRef };
}
```

- [ ] **Step 4: Commit**

```bash
git add src/renderer/hooks/
git commit -m "feat: add Zustand store, theme hook, and terminal hook"
```

---

## Task 13: Sidebar Components

**Files:**
- Create: `src/renderer/components/sidebar/StatusDot.tsx`
- Create: `src/renderer/components/sidebar/SessionEntry.tsx`
- Create: `src/renderer/components/sidebar/RepoGroup.tsx`
- Create: `src/renderer/components/sidebar/ActionBar.tsx`
- Create: `src/renderer/components/sidebar/Sidebar.tsx`

- [ ] **Step 1: Create StatusDot.tsx**

```tsx
import type { ClaudeStatus } from '../../../main/domain/types';

const statusColors: Record<ClaudeStatus, string> = {
  action: 'bg-c1',
  busy: 'bg-c3',
  done: 'bg-c2',
  none: 'bg-c0',
};

export function StatusDot({ status }: { status: ClaudeStatus }) {
  return <div className={`w-2 h-2 rounded-full shrink-0 ${statusColors[status]}`} />;
}
```

- [ ] **Step 2: Create SessionEntry.tsx**

```tsx
import type { SessionEntry as SessionEntryType, ClaudeStatus } from '../../../main/domain/types';
import { StatusDot } from './StatusDot';
import { useAppStore, refreshState } from '../../hooks/use-app-state';

function statusLabel(status: ClaudeStatus): string {
  if (status === 'action') return 'needs input';
  if (status === 'busy') return 'working';
  if (status === 'done') return 'done';
  return '';
}

const statusLabelColors: Record<ClaudeStatus, string> = {
  action: 'text-c1',
  busy: 'text-c3',
  done: 'text-c2',
  none: '',
};

interface Props {
  entry: SessionEntryType;
  repoRoot?: string;
  onRequestRemove?: () => void;
}

export function SessionEntry({ entry, repoRoot, onRequestRemove }: Props) {
  const { activeSession, setActiveSession } = useAppStore();
  const isActive = entry.tmuxSession === activeSession;
  const isOrphan = entry.tmuxSession === null;
  const label = statusLabel(entry.status);

  async function handleClick() {
    if (entry.tmuxSession) {
      setActiveSession(entry.tmuxSession);
      await window.api.switchSession(entry.tmuxSession);
    } else if (entry.worktreePath) {
      const session = `${entry.repo}/${entry.branch}`;
      await window.api.startSession(session, entry.worktreePath);
      setActiveSession(session);
      setTimeout(refreshState, 500);
    }
  }

  async function handleKill(e: React.MouseEvent) {
    e.stopPropagation();
    if (entry.tmuxSession) {
      await window.api.killSession(entry.tmuxSession);
      refreshState();
    }
  }

  return (
    <div
      onClick={handleClick}
      className={`flex items-center gap-1.5 px-3 py-[3px] cursor-pointer border-l-2 transition-colors
        ${isActive ? 'border-l-accent bg-c0' : 'border-l-transparent'}
        ${isOrphan ? 'opacity-50 hover:opacity-80' : 'hover:bg-c0'}`}
    >
      {entry.repo !== 'standalone' && <StatusDot status={entry.status} />}

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1">
          <span className="truncate text-[13px]">
            {isOrphan ? `○ ${entry.branch}` : entry.branch}
          </span>
          {entry.isMainWorktree && (
            <span className="text-[10px] text-accent/60 shrink-0">(dir)</span>
          )}
        </div>
        {entry.repo !== 'standalone' && (
          <div className="text-[10px] text-fg/30 truncate pl-px">
            origin/{entry.branch}
          </div>
        )}
      </div>

      {label && entry.tmuxSession && (
        <span className={`text-[10px] shrink-0 ${statusLabelColors[entry.status]}`}>
          {label}
        </span>
      )}

      <div className="hidden group-hover/entry:flex gap-0.5 shrink-0 ml-auto">
        {entry.tmuxSession && (
          <button
            onClick={handleKill}
            className="bg-transparent border-none text-c0 hover:text-c1 cursor-pointer text-xs px-[3px] rounded"
            title="Kill tmux session"
          >✕</button>
        )}
        {entry.repo !== 'standalone' && !entry.isMainWorktree && onRequestRemove && (
          <button
            onClick={(e) => { e.stopPropagation(); onRequestRemove(); }}
            className="bg-transparent border-none text-c0 hover:text-c1 cursor-pointer text-xs px-[3px] rounded"
            title="Remove worktree"
          >🗑</button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create RepoGroup.tsx**

```tsx
import type { SessionEntry as SessionEntryType } from '../../../main/domain/types';
import { SessionEntry } from './SessionEntry';
import { refreshState } from '../../hooks/use-app-state';
import { useState } from 'react';

interface Props {
  repo: string;
  entries: SessionEntryType[];
  repoRoot?: string;
  onNewWorktree?: () => void;
  onRemoveWorktree?: (entry: SessionEntryType) => void;
}

export function RepoGroup({ repo, entries, repoRoot, onNewWorktree, onRemoveWorktree }: Props) {
  const hasActive = entries.some((e) => e.tmuxSession !== null);

  async function handleRemoveRepo(e: React.MouseEvent) {
    e.stopPropagation();
    await window.api.removeRepo(repo);
    refreshState();
  }

  return (
    <div className="mb-1">
      <div className={`flex items-center justify-between px-3 pt-1.5 pb-0.5
        text-[11px] font-bold tracking-wider uppercase
        ${repo === 'standalone' ? 'text-c5' : 'text-accent'}`}
      >
        {repo}
        {repo !== 'standalone' && !hasActive && (
          <button
            onClick={handleRemoveRepo}
            className="bg-transparent border-none text-c0 hover:text-c1 cursor-pointer text-[10px] px-1 opacity-0 group-hover/repo:opacity-100 transition-opacity"
            title="Remove repo from sidebar"
          >✕</button>
        )}
      </div>

      {entries.map((entry) => (
        <div key={entry.tmuxSession ?? `orphan-${entry.branch}`} className="group/entry">
          <SessionEntry
            entry={entry}
            repoRoot={repoRoot}
            onRequestRemove={
              entry.repo !== 'standalone' && !entry.isMainWorktree
                ? () => onRemoveWorktree?.(entry)
                : undefined
            }
          />
        </div>
      ))}

      {repo !== 'standalone' && (
        <div
          onClick={onNewWorktree}
          className="px-3 py-0.5 pl-[26px] opacity-35 hover:opacity-70 cursor-pointer"
        >
          <span className="text-accent text-xs">+ new worktree</span>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Create ActionBar.tsx**

```tsx
interface Props {
  onNewSession: () => void;
  onClean: () => void;
}

export function ActionBar({ onNewSession, onClean }: Props) {
  return (
    <div className="px-3 py-2 border-t border-c0 flex gap-1.5">
      <button
        onClick={onNewSession}
        className="bg-c0 text-accent border-none px-2.5 py-1 rounded text-xs font-inherit cursor-pointer hover:opacity-80 transition-opacity"
      >
        + session
      </button>
      <button
        onClick={onClean}
        className="bg-c0 text-c5 border-none px-2.5 py-1 rounded text-xs font-inherit cursor-pointer hover:opacity-80 transition-opacity ml-auto"
      >
        🗑 clean
      </button>
    </div>
  );
}
```

- [ ] **Step 5: Create Sidebar.tsx**

```tsx
import { useMemo, useState } from 'react';
import { useAppStore } from '../../hooks/use-app-state';
import { RepoGroup } from './RepoGroup';
import { ActionBar } from './ActionBar';
import type { SessionEntry as SessionEntryType } from '../../../main/domain/types';

function sortEntries(entries: SessionEntryType[]): SessionEntryType[] {
  return [...entries].sort((a, b) => {
    if (a.repo === 'standalone' && b.repo !== 'standalone') return 1;
    if (a.repo !== 'standalone' && b.repo === 'standalone') return -1;
    if (a.repo !== b.repo) return a.repo.localeCompare(b.repo);
    if (a.isMainWorktree && !b.isMainWorktree) return -1;
    if (!a.isMainWorktree && b.isMainWorktree) return 1;
    return a.branch.localeCompare(b.branch);
  });
}

interface Props {
  onNewWorktree: (repo: string, repoRoot: string) => void;
  onRemoveWorktree: (entry: SessionEntryType) => void;
  onNewSession: () => void;
  onClean: () => void;
}

export function Sidebar({ onNewWorktree, onRemoveWorktree, onNewSession, onClean }: Props) {
  const { entries, repos } = useAppStore();

  const groups = useMemo(() => {
    const sorted = sortEntries(entries);
    const map = new Map<string, SessionEntryType[]>();
    for (const entry of sorted) {
      const group = map.get(entry.repo) ?? [];
      group.push(entry);
      map.set(entry.repo, group);
    }
    return map;
  }, [entries]);

  return (
    <>
      <div className="flex-1 overflow-y-auto">
        {[...groups.entries()].map(([repo, repoEntries]) => (
          <div key={repo} className="group/repo">
            <RepoGroup
              repo={repo}
              entries={repoEntries}
              repoRoot={repos.get(repo)}
              onNewWorktree={() => {
                const root = repos.get(repo);
                if (root) onNewWorktree(repo, root);
              }}
              onRemoveWorktree={onRemoveWorktree}
            />
          </div>
        ))}
      </div>
      <ActionBar onNewSession={onNewSession} onClean={onClean} />
    </>
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/sidebar/
git commit -m "feat: add sidebar components (RepoGroup, SessionEntry, StatusDot, ActionBar)"
```

---

## Task 14: Terminal + ResizeHandle Components

**Files:**
- Create: `src/renderer/components/terminal/Terminal.tsx`
- Create: `src/renderer/components/terminal/ResizeHandle.tsx`

- [ ] **Step 1: Create Terminal.tsx**

```tsx
import { useRef } from 'react';
import { useTerminal } from '../../hooks/use-terminal';

export function TerminalView() {
  const containerRef = useRef<HTMLDivElement>(null);
  useTerminal(containerRef);

  return (
    <div
      ref={containerRef}
      className="flex-1 bg-bg overflow-hidden [&_.xterm]:h-full [&_.xterm]:p-4 [&_.xterm-viewport]:!scrollbar-none"
    />
  );
}
```

- [ ] **Step 2: Create ResizeHandle.tsx**

```tsx
import { useCallback, useRef } from 'react';

interface Props {
  sidebarRef: React.RefObject<HTMLElement | null>;
  onResize: () => void;
}

export function ResizeHandle({ sidebarRef, onResize }: Props) {
  const dragging = useRef(false);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    dragging.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();

    function onMouseMove(e: MouseEvent) {
      if (!dragging.current || !sidebarRef.current) return;
      const newWidth = Math.max(120, Math.min(400, e.clientX));
      sidebarRef.current.style.width = `${newWidth}px`;
      sidebarRef.current.style.minWidth = `${newWidth}px`;
      onResize();
    }

    function onMouseUp() {
      dragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      onResize();
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    }

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [sidebarRef, onResize]);

  return (
    <div
      onMouseDown={onMouseDown}
      className="w-1 cursor-col-resize bg-c0 hover:bg-accent transition-colors"
    />
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/terminal/
git commit -m "feat: add terminal and resize handle components"
```

---

## Task 15: Dialog Components

**Files:**
- Create: `src/renderer/components/dialogs/ConfirmDialog.tsx`
- Create: `src/renderer/components/dialogs/NewSessionDialog.tsx`
- Create: `src/renderer/components/dialogs/NewWorktreeDialog.tsx`
- Create: `src/renderer/components/dialogs/RemoveWorktreeDialog.tsx`
- Create: `src/renderer/components/dialogs/CleanWorktreesDialog.tsx`

- [ ] **Step 1: Install shadcn dialog, button, input, checkbox, select components**

```bash
npx shadcn@latest add dialog button input checkbox select label
```

This copies the component source files into `src/renderer/components/ui/`.

- [ ] **Step 2: Create ConfirmDialog.tsx**

```tsx
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface Props {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  confirmLabel?: string;
  destructive?: boolean;
}

export function ConfirmDialog({ open, onClose, onConfirm, title, description, confirmLabel = 'Confirm', destructive }: Props) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="bg-bg border-c0 text-fg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="text-fg/60">{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} className="text-fg/60">Cancel</Button>
          <Button
            onClick={() => { onConfirm(); onClose(); }}
            className={destructive ? 'bg-c1 text-bg hover:bg-c1/80' : 'bg-accent text-bg hover:bg-accent/80'}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Create NewSessionDialog.tsx**

```tsx
import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { refreshState } from '../../hooks/use-app-state';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function NewSessionDialog({ open, onClose }: Props) {
  const [name, setName] = useState('');

  async function handleCreate() {
    if (!name.trim()) return;
    await window.api.createSession(name.trim());
    setName('');
    onClose();
    setTimeout(refreshState, 500);
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="bg-bg border-c0 text-fg">
        <DialogHeader>
          <DialogTitle>New Session</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-fg/60 text-xs uppercase tracking-wider">Session name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              placeholder="session name..."
              className="bg-bg border-c0 text-fg mt-1"
              autoFocus
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} className="text-fg/60">Cancel</Button>
          <Button onClick={handleCreate} disabled={!name.trim()} className="bg-accent text-bg hover:bg-accent/80">
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Create NewWorktreeDialog.tsx**

```tsx
import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { refreshState } from '../../hooks/use-app-state';
import type { BranchInfo } from '../../../main/domain/types';

interface Props {
  open: boolean;
  onClose: () => void;
  repo: string;
  repoRoot: string;
}

export function NewWorktreeDialog({ open, onClose, repo, repoRoot }: Props) {
  const [branch, setBranch] = useState('');
  const [base, setBase] = useState('origin/main');
  const [install, setInstall] = useState(true);
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open && repoRoot) {
      window.api.getBranches(repoRoot).then(setBranches);
    }
  }, [open, repoRoot]);

  async function handleCreate() {
    if (!branch.trim()) return;
    setLoading(true);
    setError('');
    const result = await window.api.createWorktree({
      repo,
      repoRoot,
      branch: branch.trim(),
      base,
      install,
    });
    setLoading(false);

    if (result.success) {
      setBranch('');
      onClose();
      setTimeout(refreshState, 500);
    } else {
      setError(result.error);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="bg-bg border-c0 text-fg">
        <DialogHeader>
          <DialogTitle>New Worktree</DialogTitle>
          <DialogDescription className="text-fg/60">
            Create a new git worktree and launch a tmux session
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label className="text-fg/60 text-xs uppercase tracking-wider">Repository</Label>
            <div className="bg-bg border border-c0 rounded-md px-3 py-2 text-accent text-sm mt-1">{repo}</div>
          </div>

          <div>
            <Label className="text-fg/60 text-xs uppercase tracking-wider">Branch name</Label>
            <Input
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              placeholder="feat-my-feature"
              className="bg-bg border-c0 text-fg mt-1"
              autoFocus
            />
          </div>

          <div>
            <Label className="text-fg/60 text-xs uppercase tracking-wider">Base ref</Label>
            <Select value={base} onValueChange={setBase}>
              <SelectTrigger className="bg-bg border-c0 text-fg mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-bg border-c0 text-fg">
                <SelectItem value="origin/main">origin/main (default)</SelectItem>
                {branches.map((b) => (
                  <SelectItem key={b.name} value={b.isRemote ? `origin/${b.name}` : b.name}>
                    {b.isRemote ? `origin/${b.name}` : b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="install"
              checked={install}
              onCheckedChange={(v) => setInstall(v === true)}
            />
            <Label htmlFor="install" className="text-sm">Run install command</Label>
          </div>

          {error && (
            <div className="text-c1 text-sm bg-c1/10 p-2 rounded">{error}</div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} className="text-fg/60">Cancel</Button>
          <Button
            onClick={handleCreate}
            disabled={!branch.trim() || loading}
            className="bg-accent text-bg hover:bg-accent/80"
          >
            {loading ? 'Creating...' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 5: Create RemoveWorktreeDialog.tsx**

```tsx
import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { refreshState, useAppStore } from '../../hooks/use-app-state';
import type { SessionEntry } from '../../../main/domain/types';

interface Props {
  open: boolean;
  onClose: () => void;
  entry: SessionEntry | null;
}

export function RemoveWorktreeDialog({ open, onClose, entry }: Props) {
  const [deleteBranch, setDeleteBranch] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const repos = useAppStore((s) => s.repos);

  async function handleRemove() {
    if (!entry) return;
    const repoRoot = repos.get(entry.repo);
    if (!repoRoot) return;

    setLoading(true);
    setError('');
    const result = await window.api.removeWorktree(repoRoot, entry.branch, deleteBranch);
    setLoading(false);

    if (result.success) {
      setDeleteBranch(false);
      onClose();
      refreshState();
    } else {
      setError(result.error);
    }
  }

  if (!entry) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="bg-bg border-c0 text-fg">
        <DialogHeader>
          <DialogTitle>Remove Worktree</DialogTitle>
          <DialogDescription className="text-fg/60">
            This will remove the worktree directory, kill the tmux session, and optionally delete the branch.
          </DialogDescription>
        </DialogHeader>

        <div className="bg-c0/50 rounded-md p-3 text-sm space-y-1">
          <div className="flex justify-between">
            <span className="text-fg/60">Repo</span>
            <span className="text-accent">{entry.repo}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-fg/60">Branch</span>
            <span>{entry.branch}</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Checkbox
            id="delete-branch"
            checked={deleteBranch}
            onCheckedChange={(v) => setDeleteBranch(v === true)}
          />
          <Label htmlFor="delete-branch" className="text-sm">Also delete branch</Label>
        </div>

        {error && (
          <div className="text-c1 text-sm bg-c1/10 p-2 rounded">{error}</div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} className="text-fg/60">Cancel</Button>
          <Button
            onClick={handleRemove}
            disabled={loading}
            className="bg-c1 text-bg hover:bg-c1/80"
          >
            {loading ? 'Removing...' : 'Remove'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 6: Create CleanWorktreesDialog.tsx**

```tsx
import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import type { CleanCandidate } from '../../../main/domain/types';
import { refreshState } from '../../hooks/use-app-state';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function CleanWorktreesDialog({ open, onClose }: Props) {
  const [candidates, setCandidates] = useState<CleanCandidate[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(false);

  useEffect(() => {
    if (open) {
      setFetching(true);
      window.api.getCleanCandidates().then((c) => {
        setCandidates(c);
        setSelected(new Set());
        setFetching(false);
      });
    }
  }, [open]);

  function toggleCandidate(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function handleClean() {
    const items = candidates
      .filter((c) => selected.has(`${c.repoRoot}:${c.branch}`))
      .map((c) => ({
        repoRoot: c.repoRoot,
        branch: c.branch,
        worktreePath: c.worktreePath,
        deleteBranch: true,
      }));

    setLoading(true);
    await window.api.cleanWorktrees(items);
    setLoading(false);
    onClose();
    refreshState();
  }

  // Group by repo
  const groups = new Map<string, CleanCandidate[]>();
  for (const c of candidates) {
    const g = groups.get(c.repo) ?? [];
    g.push(c);
    groups.set(c.repo, g);
  }

  const reasonBadge = (reason: CleanCandidate['reason']) => {
    if (reason === 'merged') {
      return <span className="text-[10px] text-c2 bg-c2/10 px-1.5 py-0.5 rounded">merged to staging</span>;
    }
    return <span className="text-[10px] text-c3 bg-c3/10 px-1.5 py-0.5 rounded">remote deleted</span>;
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="bg-bg border-c0 text-fg max-w-lg">
        <DialogHeader>
          <DialogTitle>Clean Stale Worktrees</DialogTitle>
          <DialogDescription className="text-fg/60">
            Worktrees that are merged or have deleted remote branches
          </DialogDescription>
        </DialogHeader>

        {fetching ? (
          <div className="text-fg/50 text-sm py-4 text-center">Scanning repos...</div>
        ) : candidates.length === 0 ? (
          <div className="text-fg/50 text-sm py-4 text-center">No stale worktrees found.</div>
        ) : (
          <div className="space-y-4 max-h-[400px] overflow-y-auto">
            {[...groups.entries()].map(([repo, items]) => (
              <div key={repo}>
                <div className="text-[11px] text-accent font-bold uppercase tracking-wider mb-2">{repo}</div>
                {items.map((c) => {
                  const key = `${c.repoRoot}:${c.branch}`;
                  return (
                    <div
                      key={key}
                      onClick={() => toggleCandidate(key)}
                      className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer hover:bg-c0/50
                        ${selected.has(key) ? 'bg-c0/30' : ''}`}
                    >
                      <Checkbox checked={selected.has(key)} />
                      <span className="text-sm flex-1">{c.branch}</span>
                      {reasonBadge(c.reason)}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}

        <DialogFooter className="flex items-center justify-between">
          <span className="text-fg/60 text-xs">{selected.size} selected</span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose} className="text-fg/60">Cancel</Button>
            <Button
              onClick={handleClean}
              disabled={selected.size === 0 || loading}
              className="bg-c1 text-bg hover:bg-c1/80"
            >
              {loading ? 'Cleaning...' : `Clean ${selected.size} worktree${selected.size !== 1 ? 's' : ''}`}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 7: Commit**

```bash
git add src/renderer/components/dialogs/
git commit -m "feat: add dialog components (NewWorktree, RemoveWorktree, CleanWorktrees, NewSession, Confirm)"
```

---

## Task 16: Wire Up App.tsx

**Files:**
- Modify: `src/renderer/App.tsx`

- [ ] **Step 1: Update App.tsx with full layout and dialog wiring**

Replace the minimal shell from Task 11 with the full implementation:

```tsx
import { useRef, useState } from 'react';
import { Sidebar } from './components/sidebar/Sidebar';
import { TerminalView } from './components/terminal/Terminal';
import { ResizeHandle } from './components/terminal/ResizeHandle';
import { NewWorktreeDialog } from './components/dialogs/NewWorktreeDialog';
import { RemoveWorktreeDialog } from './components/dialogs/RemoveWorktreeDialog';
import { CleanWorktreesDialog } from './components/dialogs/CleanWorktreesDialog';
import { NewSessionDialog } from './components/dialogs/NewSessionDialog';
import { useAppStateSubscription } from './hooks/use-app-state';
import { useTheme } from './hooks/use-theme';
import type { SessionEntry } from '../main/domain/types';

export function App() {
  useAppStateSubscription();
  useTheme();

  const sidebarRef = useRef<HTMLElement>(null);

  // Dialog state
  const [newWorktreeOpen, setNewWorktreeOpen] = useState(false);
  const [newWorktreeRepo, setNewWorktreeRepo] = useState('');
  const [newWorktreeRoot, setNewWorktreeRoot] = useState('');

  const [removeEntry, setRemoveEntry] = useState<SessionEntry | null>(null);
  const [cleanOpen, setCleanOpen] = useState(false);
  const [newSessionOpen, setNewSessionOpen] = useState(false);

  function handleNewWorktree(repo: string, repoRoot: string) {
    setNewWorktreeRepo(repo);
    setNewWorktreeRoot(repoRoot);
    setNewWorktreeOpen(true);
  }

  return (
    <div className="flex h-screen">
      <aside ref={sidebarRef} className="w-[220px] min-w-[220px] bg-bg flex flex-col py-2">
        <Sidebar
          onNewWorktree={handleNewWorktree}
          onRemoveWorktree={(entry) => setRemoveEntry(entry)}
          onNewSession={() => setNewSessionOpen(true)}
          onClean={() => setCleanOpen(true)}
        />
      </aside>

      <ResizeHandle sidebarRef={sidebarRef} onResize={() => {}} />

      <TerminalView />

      {/* Dialogs */}
      <NewWorktreeDialog
        open={newWorktreeOpen}
        onClose={() => setNewWorktreeOpen(false)}
        repo={newWorktreeRepo}
        repoRoot={newWorktreeRoot}
      />
      <RemoveWorktreeDialog
        open={removeEntry !== null}
        onClose={() => setRemoveEntry(null)}
        entry={removeEntry}
      />
      <CleanWorktreesDialog
        open={cleanOpen}
        onClose={() => setCleanOpen(false)}
      />
      <NewSessionDialog
        open={newSessionOpen}
        onClose={() => setNewSessionOpen(false)}
      />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/App.tsx
git commit -m "feat: wire App.tsx with sidebar, terminal, and all dialogs"
```

---

## Task 17: Delete Old Files + Final Build Verification

**Files:**
- Delete: `main.js`, `preload.js`, `index.html`, `styles.css`, `src/renderer.ts` (any remaining)
- Update: `.gitignore`

- [ ] **Step 1: Remove any remaining old files**

```bash
rm -f main.js preload.js index.html styles.css src/renderer.ts
rm -rf dist/
```

- [ ] **Step 2: Add .gitignore entries**

Append to `.gitignore` (create if needed):

```
node_modules/
out/
dist/
.superpowers/
```

- [ ] **Step 3: Run full build**

```bash
npx electron-vite build
```

Expected: builds cleanly to `out/main/`, `out/preload/`, `out/renderer/`.

- [ ] **Step 4: Run the app**

```bash
npx electron-vite dev
```

Expected: window opens with sidebar + terminal. Existing tmux sessions appear. Theme loads from Omarchy.

- [ ] **Step 5: Test core flows manually**

Verify each of these works:
- Click a session → terminal switches
- Click an orphan → session created with Claude Code + lazygit + Shell windows
- Click "+ new worktree" → dialog opens with branch input, base ref select, install toggle
- Fill dialog and click Create → worktree created, session launches
- Click 🗑 on a worktree entry → remove dialog with "also delete branch" checkbox
- Click "clean" in action bar → dialog shows stale worktrees grouped by repo
- Theme changes when Omarchy theme is updated
- Resize handle works

- [ ] **Step 6: Commit all remaining changes**

```bash
git add -A
git commit -m "feat: complete architecture overhaul — self-contained worktree manager"
```

---

## Task 18: Electron Forge Packaging

**Files:**
- Create: `forge.config.ts`

- [ ] **Step 1: Install Electron Forge**

```bash
npm install --save-dev @electron-forge/cli @electron-forge/maker-deb @electron-forge/maker-rpm @electron-forge/maker-zip
```

- [ ] **Step 2: Create forge.config.ts**

```typescript
import type { ForgeConfig } from '@electron-forge/shared-types';

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    executableName: 'gustav',
    name: 'Gustav',
  },
  makers: [
    {
      name: '@electron-forge/maker-zip',
      platforms: ['linux'],
    },
    {
      name: '@electron-forge/maker-deb',
      config: {
        options: {
          name: 'gustav',
          productName: 'Gustav',
          description: 'Git worktree manager with tmux integration',
        },
      },
    },
  ],
};

export default config;
```

- [ ] **Step 3: Add forge scripts to package.json**

Add these scripts alongside existing ones:

```json
{
  "scripts": {
    "package": "electron-vite build && electron-forge package",
    "make": "electron-vite build && electron-forge make"
  }
}
```

- [ ] **Step 4: Verify packaging**

```bash
npm run package
```

Expected: creates `out/gustav-linux-x64/` (or similar) directory with packaged app.

- [ ] **Step 5: Verify no wt CLI references remain**

```bash
grep -r "wt " src/ --include="*.ts" --include="*.tsx" | grep -v "worktree\|\.wt\|wtDir\|wtPath\|WtConfig"
```

Expected: no results. All `wt` CLI calls have been replaced.

- [ ] **Step 6: Commit**

```bash
git add forge.config.ts package.json
git commit -m "feat: add Electron Forge packaging config"
```
