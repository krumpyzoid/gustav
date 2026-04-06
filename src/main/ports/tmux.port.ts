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
  listWindows(session: string): Promise<{ index: number; name: string; active: boolean }[]>;
}
