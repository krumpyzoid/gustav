import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { xtermTheme } from './use-theme';
import { navigateSession, navigateWindow } from './use-keyboard-shortcuts';
import { useAppStore } from './use-app-state';

let globalTermRef: Terminal | null = null;

export function focusTerminal() {
  globalTermRef?.focus();
}

export function useTerminal(containerRef: React.RefObject<HTMLDivElement | null>) {
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontFamily: '"GeistMono NF Mono", monospace',
      fontSize: 13,
      allowProposedApi: true,
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);

    termRef.current = term;
    fitRef.current = fitAddon;
    globalTermRef = term;

    function fit() {
      fitAddon.fit();
      window.api.sendPtyResize(term.cols, term.rows);
      // Also notify remote PTY if attached
      const store = useAppStore.getState();
      if (store.isRemoteSession && store.remotePtyChannelId !== null) {
        window.api.sendRemotePtyResize(store.remotePtyChannelId, term.cols, term.rows);
      }
    }

    setTimeout(fit, 100);
    const resizeObserver = new ResizeObserver(() => fit());
    resizeObserver.observe(containerRef.current);

    // PTY data (local)
    const cleanupPty = window.api.onPtyData((data) => {
      if (!useAppStore.getState().isRemoteSession) term.write(data);
    });

    // PTY data (remote) — main process already decoded the frame, sends plain string
    const cleanupRemotePty = window.api.onRemotePtyData?.((data: string) => {
      if (useAppStore.getState().isRemoteSession && data) {
        term.write(data);
      }
    });

    // Custom key handler: Shift+Enter, Alt+Arrows, Ctrl+/-, Ctrl+0
    term.attachCustomKeyEventHandler((event) => {
      if (event.key === 'Enter' && event.shiftKey) {
        if (event.type === 'keydown') window.api.sendPtyInput('\x1b[13;2u');
        return false;
      }
      // Alt+Arrow: global navigation shortcuts
      if (event.altKey && event.type === 'keydown') {
        if (event.key === 'ArrowDown') { navigateSession(1); return false; }
        if (event.key === 'ArrowUp') { navigateSession(-1); return false; }
        if (event.key === 'ArrowRight') { navigateWindow(1); return false; }
        if (event.key === 'ArrowLeft') { navigateWindow(-1); return false; }
      }
      if (event.ctrlKey && event.type === 'keydown') {
        const current = term.options.fontSize ?? 13;
        if (event.key === '=' || event.key === '+') {
          setAppFontSize(Math.min(32, current + 1));
          return false;
        }
        if (event.key === '-') {
          setAppFontSize(Math.max(6, current - 1));
          return false;
        }
        if (event.key === '0') {
          setAppFontSize(13);
          return false;
        }
      }
      return true;
    });

    // Input relay — route to local or remote PTY
    term.onData((data) => {
      const store = useAppStore.getState();
      if (store.isRemoteSession && store.remotePtyChannelId !== null) {
        window.api.sendRemotePtyInput(store.remotePtyChannelId, data);
      } else {
        window.api.sendPtyInput(data);
      }
    });

    // Trackpad/mouse wheel scrolling fix.
    // tmux uses the alternate screen buffer which has no scrollback,
    // so xterm.js converts wheel events to arrow-key sequences (cycling
    // through shell history). Override this to send SGR 1006 mouse wheel
    // escape sequences that tmux handles as scrollback navigation.
    term.attachCustomWheelEventHandler((event: WheelEvent) => {
      const amount = Math.max(1, Math.min(5, Math.ceil(Math.abs(event.deltaY) / 25)));
      const button = event.deltaY < 0 ? 64 : 65; // SGR: 64=wheel up, 65=wheel down
      const seq = `\x1b[<${button};1;1M`;
      const store = useAppStore.getState();
      for (let i = 0; i < amount; i++) {
        if (store.isRemoteSession && store.remotePtyChannelId !== null) {
          window.api.sendRemotePtyInput(store.remotePtyChannelId, seq);
        } else {
          window.api.sendPtyInput(seq);
        }
      }
      return false;
    });

    // Auto-copy selection to clipboard on mouseup
    term.onSelectionChange(() => {
      const selection = term.getSelection();
      if (selection) {
        navigator.clipboard.writeText(selection);
      }
    });

    // Theme updates
    window.api.getTheme().then((colors) => {
      term.options.theme = xtermTheme(colors);
    });
    const cleanupTheme = window.api.onThemeUpdate((colors) => {
      term.options.theme = xtermTheme(colors);
    });

    // Global keyboard listener for font size (scales terminal + sidebar together)
    function setAppFontSize(size: number) {
      term.options.fontSize = size;
      document.documentElement.style.fontSize = `${size}px`;
      fit();
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (!e.ctrlKey) return;
      const current = term.options.fontSize ?? 13;
      if (e.key === '=' || e.key === '+') {
        e.preventDefault();
        setAppFontSize(Math.min(32, current + 1));
      } else if (e.key === '-') {
        e.preventDefault();
        setAppFontSize(Math.max(6, current - 1));
      } else if (e.key === '0') {
        e.preventDefault();
        setAppFontSize(13);
      }
    }
    document.addEventListener('keydown', handleKeyDown);

    term.focus();

    return () => {
      globalTermRef = null;
      document.removeEventListener('keydown', handleKeyDown);
      cleanupPty();
      cleanupRemotePty?.();
      cleanupTheme();
      resizeObserver.disconnect();
      term.dispose();
    };
  }, [containerRef]);

  return { termRef, fitRef };
}
