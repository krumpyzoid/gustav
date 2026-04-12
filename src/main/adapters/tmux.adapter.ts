import type { TmuxPort, PaneInfo } from '../ports/tmux.port';
import type { ShellPort } from '../ports/shell.port';

const SEP = '|||';

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
    await this.exec(`send-keys -t '${target}' '${keys}' Enter`);
  }

  async selectWindow(session: string, window: string): Promise<void> {
    await this.exec(`select-window -t '${session}':'${window}'`);
  }

  async killWindow(session: string, windowIndex: number): Promise<void> {
    await this.exec(`kill-window -t '${session}':${windowIndex}`);
  }

  async listPanes(session: string): Promise<string> {
    return this.exec(`list-panes -t '${session}' -s -F '#{pane_id}${SEP}#{window_name}${SEP}#{pane_current_command}'`);
  }

  async listPanesExtended(session: string): Promise<PaneInfo[]> {
    const raw = await this.exec(`list-panes -t '${session}' -s -F '#{pane_id}${SEP}#{window_name}${SEP}#{pane_current_command}${SEP}#{pane_pid}'`);
    if (!raw) return [];
    return raw.split('\n').filter(Boolean).map((line) => {
      const [paneId, windowName, paneCommand, pid] = line.split(SEP);
      return { paneId, windowName, paneCommand, panePid: Number(pid) };
    });
  }

  async capturePaneContent(paneId: string): Promise<string> {
    return this.exec(`capture-pane -t '${paneId}' -p`);
  }

  async displayMessage(target: string, format: string): Promise<string> {
    return this.exec(`display-message -t '${target}' -p '${format}'`);
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
    const raw = await this.exec(`list-windows -t '${session}' -F '#{window_index}${SEP}#{window_name}${SEP}#{window_active}'`);
    if (!raw) return [];
    return raw.split('\n').filter(Boolean).map((line) => {
      const [idx, name, active] = line.split(SEP);
      return { index: Number(idx), name, active: active === '1' };
    });
  }
}
