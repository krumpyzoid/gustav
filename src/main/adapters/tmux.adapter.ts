import type { TmuxPort, PaneInfo } from '../ports/tmux.port';
import type { ShellPort } from '../ports/shell.port';

const SEP = '|||';

/** Escape single quotes for safe interpolation into shell strings: ' → '\'' */
function q(s: string): string {
  return s.replace(/'/g, "'\\''");
}

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
      await this.shell.exec(`tmux has-session -t '${q(session)}'`);
      return true;
    } catch {
      return false;
    }
  }

  async newSession(name: string, opts: { windowName: string; cwd: string }): Promise<void> {
    await this.exec(`new-session -d -s '${q(name)}' -n '${q(opts.windowName)}' -c '${q(opts.cwd)}'`);
    // aggressive-resize is a per-window option that doesn't inherit through tmux's
    // session defaults, so each new window must set it explicitly. See newWindow.
    await this.exec(`set-window-option -t '${q(name)}':'${q(opts.windowName)}' aggressive-resize on`);
  }

  async killSession(session: string): Promise<void> {
    await this.exec(`kill-session -t '${q(session)}'`);
  }

  async switchClient(tty: string, target: string): Promise<void> {
    await this.exec(`switch-client -c '${q(tty)}' -t '${q(target)}'`);
  }

  async newWindow(session: string, name: string, cwd: string): Promise<void> {
    await this.exec(`new-window -t '${q(session)}' -n '${q(name)}' -c '${q(cwd)}'`);
    await this.exec(`set-window-option -t '${q(session)}':'${q(name)}' aggressive-resize on`);
  }

  async sendKeys(target: string, keys: string): Promise<void> {
    await this.exec(`send-keys -t '${q(target)}' '${q(keys)}' Enter`);
  }

  async selectWindow(session: string, window: string): Promise<void> {
    await this.exec(`select-window -t '${q(session)}':'${q(window)}'`);
  }

  async killWindow(session: string, windowIndex: number): Promise<void> {
    await this.exec(`kill-window -t '${q(session)}':${windowIndex}`);
  }

  async listPanes(session: string): Promise<string> {
    return this.exec(`list-panes -t '${q(session)}' -s -F '#{pane_id}${SEP}#{window_name}${SEP}#{pane_current_command}'`);
  }

  async listPanesExtended(session: string): Promise<PaneInfo[]> {
    const raw = await this.exec(`list-panes -t '${q(session)}' -s -F '#{pane_id}${SEP}#{window_name}${SEP}#{pane_current_command}${SEP}#{pane_pid}${SEP}#{pane_current_path}'`);
    if (!raw) return [];
    return raw.split('\n').filter(Boolean).map((line) => {
      const [paneId, windowName, paneCommand, pid, cwd] = line.split(SEP);
      return { paneId, windowName, paneCommand, panePid: Number(pid), paneCwd: cwd ?? '' };
    });
  }

  async capturePaneContent(paneId: string): Promise<string> {
    return this.exec(`capture-pane -t '${q(paneId)}' -p`);
  }

  async displayMessage(target: string, format: string): Promise<string> {
    return this.exec(`display-message -t '${q(target)}' -p '${q(format)}'`);
  }

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

  async listWindows(session: string): Promise<{ index: number; name: string; active: boolean }[]> {
    const raw = await this.exec(`list-windows -t '${q(session)}' -F '#{window_index}${SEP}#{window_name}${SEP}#{window_active}'`);
    if (!raw) return [];
    return raw.split('\n').filter(Boolean).map((line) => {
      const [idx, name, active] = line.split(SEP);
      return { index: Number(idx), name, active: active === '1' };
    });
  }
}
