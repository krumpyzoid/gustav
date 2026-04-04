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
