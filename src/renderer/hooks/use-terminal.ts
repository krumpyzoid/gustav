import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { xtermTheme } from './use-theme';

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

    function fit() {
      fitAddon.fit();
      window.api.sendPtyResize(term.cols, term.rows);
    }

    setTimeout(fit, 100);
    const resizeObserver = new ResizeObserver(() => fit());
    resizeObserver.observe(containerRef.current);

    // PTY data
    const cleanupPty = window.api.onPtyData((data) => term.write(data));

    // Custom key handler: Shift+Enter, Ctrl+/-, Ctrl+0
    term.attachCustomKeyEventHandler((event) => {
      if (event.key === 'Enter' && event.shiftKey) {
        if (event.type === 'keydown') window.api.sendPtyInput('\x1b[13;2u');
        return false;
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

    // Input relay
    term.onData((data) => window.api.sendPtyInput(data));

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
      document.removeEventListener('keydown', handleKeyDown);
      cleanupPty();
      cleanupTheme();
      resizeObserver.disconnect();
      term.dispose();
    };
  }, [containerRef]);

  return { termRef, fitRef };
}
