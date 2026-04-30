import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { xtermTheme } from './use-theme';
import { navigateSession, navigateWindow } from './use-keyboard-shortcuts';
import { useAppStore } from './use-app-state';
import type { SessionTransport } from '../lib/transport/session-transport';
import { isXtermAutoReply } from '../lib/terminal/auto-reply-filter';

let globalTermRef: Terminal | null = null;
let globalRequestFit: (() => void) | null = null;

export function focusTerminal() {
  globalTermRef?.focus();
}

/**
 * Live cols/rows from the mounted xterm.js instance, or null if the terminal
 * isn't mounted yet (initial app boot, before React paints). Callers should
 * pass this through to `switchSession({ cols, rows })` so remote PTYs are
 * spawned at the actual viewport size.
 */
export function getTerminalSize(): { cols: number; rows: number } | null {
  const t = globalTermRef;
  if (!t) return null;
  return { cols: t.cols, rows: t.rows };
}

/**
 * Ask the mounted terminal to refit and push the resulting cols/rows to the
 * active transport.
 *
 * Use this after view-changing operations that the `ResizeObserver` won't
 * see and that don't swap the active transport — primarily window-tab
 * switches inside the same session (#14). The hook *self-fits* on every
 * transport change via its `[activeTransport]` effect (#16), so callers
 * should not invoke this around `setActiveTransport` — doing so races
 * React's commit and is the bug #16 was filed to fix.
 *
 * No-op when no terminal is mounted (e.g. tests, headless boot).
 */
export function requestTerminalFit(): void {
  globalRequestFit?.();
}

export function useTerminal(containerRef: React.RefObject<HTMLDivElement | null>) {
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  // Subscribed via the store so this hook re-runs only its
  // PTY-data-subscription effect when the active transport flips —
  // the terminal instance itself stays alive across swaps.
  const activeTransport = useAppStore((s) => s.activeTransport);
  // Buffer incoming PTY data until the first fit completes. Without this the
  // terminal renders briefly at xterm's default 80x24, then reflows when the
  // ResizeObserver fires — visible as a flicker on session attach.
  const firstFitDoneRef = useRef(false);
  const earlyBufferRef = useRef<string[]>([]);

  // ── Terminal lifecycle (mounted once) ───────────────────────────
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
    // Captured by the closures below — flipped to true in cleanup so any
    // already-scheduled rAF callback short-circuits instead of touching a
    // disposed Terminal / fitAddon (use-after-unmount guard).
    let disposed = false;
    // Expose fit() to module-scope callers (requestTerminalFit) so view
    // changes (session/window switches) can ask for a redraw without owning
    // a ref to the hook. Schedule on rAF so layout settles first.
    globalRequestFit = () => {
      requestAnimationFrame(() => {
        if (disposed) return;
        fit();
      });
    };

    function fit() {
      if (disposed) return;
      if (!containerRef.current) return;
      // The container may not have laid out yet on first mount. Without dimensions
      // FitAddon would compute 0 cols/rows.
      if (containerRef.current.clientWidth === 0 || containerRef.current.clientHeight === 0) return;
      fitAddon.fit();
      currentTransport().sendPtyResize(term.cols, term.rows);
      if (!firstFitDoneRef.current) {
        firstFitDoneRef.current = true;
        if (earlyBufferRef.current.length > 0) {
          term.write(earlyBufferRef.current.join(''));
          earlyBufferRef.current = [];
        }
      }
    }

    // rAF instead of setTimeout(_, 100) — guarantees layout is computed before
    // the first fit, no arbitrary delay. Also guarded by `disposed` so a
    // cleanup that races a pending tryFit doesn't leave a self-rescheduling
    // loop alive.
    let initialFitFrame = requestAnimationFrame(function tryFit() {
      if (disposed || firstFitDoneRef.current) return;
      fit();
      if (!disposed && !firstFitDoneRef.current) initialFitFrame = requestAnimationFrame(tryFit);
    });

    const resizeObserver = new ResizeObserver(() => fit());
    resizeObserver.observe(containerRef.current);

    // Custom key handler: Shift+Enter, Alt+Arrows, Ctrl+/-, Ctrl+0
    term.attachCustomKeyEventHandler((event) => {
      if (event.key === 'Enter' && event.shiftKey) {
        if (event.type === 'keydown') currentTransport().sendPtyInput('\x1b[13;2u');
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

    // Input relay — route through the active transport regardless of where
    // the session lives.
    //
    // Invariants:
    //  - Bytes emitted via `onData` MUST NEVER reach `term.write` (#15).
    //    The structural shape of this handler is the proof; do not add a
    //    branch that writes back to the local terminal here.
    //  - Auto-replies (DA1/DA2/DSR) emitted by xterm.js in response to
    //    queries from the host MUST be filtered before reaching the remote
    //    PTY (#17). Without the filter, the inner shell's readline echoes
    //    the unmatched tail back through `onPtyData`, surfacing visibly as
    //    `?1;2c` at the prompt. xterm.js emits these replies as atomic
    //    single-call onData events, so an exact-match filter on the whole
    //    string is safe — real user input that merely contains a similar
    //    sequence is preserved.
    term.onData((data) => {
      if (isXtermAutoReply(data)) return;
      currentTransport().sendPtyInput(data);
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
      const transport = currentTransport();
      for (let i = 0; i < amount; i++) {
        transport.sendPtyInput(seq);
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
      disposed = true;
      globalTermRef = null;
      globalRequestFit = null;
      cancelAnimationFrame(initialFitFrame);
      document.removeEventListener('keydown', handleKeyDown);
      cleanupTheme();
      resizeObserver.disconnect();
      term.dispose();
    };
  }, [containerRef]);

  // ── PTY data subscription (re-runs on transport swap) ───────────
  // Kept in a separate effect so the terminal instance survives transport
  // flips. When the active transport changes, we just re-subscribe to its
  // PTY data stream; the xterm.js viewport, scrollback, and font state
  // stay intact.
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;

    const cleanup = activeTransport.onPtyData((data) => {
      if (!data) return;
      if (firstFitDoneRef.current) term.write(data);
      else earlyBufferRef.current.push(data);
    });

    return cleanup;
  }, [activeTransport]);

  // ── Auto-fit on transport change (#16) ──────────────────────────
  // After every transport swap, the new PTY's dimensions and xterm.js's
  // viewport must be re-synced. Without this, switching to a fresh remote
  // transport leaves the new PTY at its attach-time geometry while the
  // renderer paints onto the (potentially different) container size — the
  // user sees a stale or clipped buffer until they manually click a window
  // tab. Driving the fit from a `[activeTransport]` effect closes the race
  // by guaranteeing the fit runs *after* React's commit (and thus after
  // the new transport is the one `currentTransport()` returns).
  useEffect(() => {
    requestTerminalFit();
  }, [activeTransport]);

  return { termRef, fitRef };
}

/**
 * Always pull the *current* active transport from the store rather than
 * closing over the one captured at effect-mount time. This keeps input
 * handlers (`onData`, custom key/wheel) routing to whichever transport is
 * active right now — no stale references after a swap.
 */
function currentTransport(): SessionTransport {
  return useAppStore.getState().activeTransport;
}
