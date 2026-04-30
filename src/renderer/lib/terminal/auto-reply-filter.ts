/**
 * Match the exact set of auto-replies xterm.js emits via `term.onData` in
 * response to terminal control queries (DA1 / DA2 / DSR cursor-position).
 * Used to filter these replies at the renderer's PTY-input boundary so they
 * are not forwarded to the remote PTY — where the inner shell's readline
 * would echo the unmatched printable tail back to the visible buffer (#17,
 * the `?1;2c` glitch).
 *
 * Matching is exact-on-whole-string by design. xterm.js emits these replies
 * as a single, atomic `onData` call, so a regex anchored with `^...$` is
 * sufficient to identify the auto-reply without ever swallowing real user
 * input that merely *contains* a similar sequence (e.g. paste of escape-
 * laden content).
 *
 * Patterns covered:
 *   - DA1:  CSI [ ? params c           e.g. \x1b[?1;2c
 *   - DA2:  CSI [ > params c           e.g. \x1b[>0;276;0c
 *   - DSR:  CSI [ row ; col R          e.g. \x1b[24;80R
 *
 * params are digit groups separated by ';'. The DA / DSR families are the
 * only auto-replies xterm.js emits in our configuration. If we add any of
 * the more exotic xterm features (e.g. window-manipulation reports, OSC
 * color reports) the matchers here need to grow.
 */

const PATTERNS = [
  /^\x1b\[\?\d+(?:;\d+)*c$/,   // DA1: ESC [ ? digits c
  /^\x1b\[>\d+(?:;\d+)*c$/,    // DA2: ESC [ > digits c
  /^\x1b\[\d+;\d+R$/,          // DSR: ESC [ row ; col R
] as const;

export function isXtermAutoReply(data: string): boolean {
  if (data.length === 0) return false;
  for (const pat of PATTERNS) {
    if (pat.test(data)) return true;
  }
  return false;
}
