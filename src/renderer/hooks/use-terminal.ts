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

    // Buffer incoming PTY data until the first fit completes. Without this the
    // terminal renders briefly at xterm's default 80x24, then reflows when the
    // ResizeObserver fires — visible as a flicker on session attach.
    let firstFitDone = false;
    const earlyBuffer: string[] = [];

    function fit() {
      if (!containerRef.current) return;
      // The container may not have laid out yet on first mount. Without dimensions
      // FitAddon would compute 0 cols/rows.
      if (containerRef.current.clientWidth === 0 || containerRef.current.clientHeight === 0) return;
      fitAddon.fit();
      window.api.sendPtyResize(term.cols, term.rows);
      const store = useAppStore.getState();
      if (store.isRemoteSession && store.remotePtyChannelId !== null) {
        window.api.sendRemotePtyResize(store.remotePtyChannelId, term.cols, term.rows);
      }
      if (!firstFitDone) {
        firstFitDone = true;
        if (earlyBuffer.length > 0) {
          term.write(earlyBuffer.join(''));
          earlyBuffer.length = 0;
        }
      }
    }

    // rAF instead of setTimeout(_, 100) — guarantees layout is computed before
    // the first fit, no arbitrary delay.
    let initialFitFrame = requestAnimationFrame(function tryFit() {
      if (firstFitDone) return;
      fit();
      if (!firstFitDone) initialFitFrame = requestAnimationFrame(tryFit);
    });

    const resizeObserver = new ResizeObserver(() => fit());
    resizeObserver.observe(containerRef.current);

    // PTY data (local). Buffered until first fit so the terminal never paints at
    // its default size before reflowing.
    const cleanupPty = window.api.onPtyData((data) => {
      if (useAppStore.getState().isRemoteSession) return;
      if (firstFitDone) term.write(data);
      else earlyBuffer.push(data);
    });

    // PTY data (remote) — main process already decoded the frame, sends plain string
    const cleanupRemotePty = window.api.onRemotePtyData?.((data: string) => {
      if (!useAppStore.getState().isRemoteSession || !data) return;
      if (firstFitDone) term.write(data);
      else earlyBuffer.push(data);
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

    // Auto-copy selection to clipboard on mouseup. Routed through main process
    // because navigator.clipboard.writeText silently fails on macOS when the
    // renderer is unfocused.
    term.onSelectionChange(() => {
      const selection = term.getSelection();
      if (selection) {
        window.api.writeClipboard(selection);
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
      cancelAnimationFrame(initialFitFrame);
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
