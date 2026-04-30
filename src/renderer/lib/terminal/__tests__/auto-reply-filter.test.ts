import { describe, it, expect } from 'vitest';
import { isXtermAutoReply } from '../auto-reply-filter';

describe('isXtermAutoReply', () => {
  it('matches DA1 (Primary Device Attributes) replies', () => {
    expect(isXtermAutoReply('\x1b[?1;2c')).toBe(true);
    expect(isXtermAutoReply('\x1b[?6c')).toBe(true);
    expect(isXtermAutoReply('\x1b[?64;1;2;6;9;15;18;21;22c')).toBe(true);
  });

  it('matches DA2 (Secondary Device Attributes) replies', () => {
    expect(isXtermAutoReply('\x1b[>0;276;0c')).toBe(true);
    expect(isXtermAutoReply('\x1b[>1;95;0c')).toBe(true);
  });

  it('matches DSR cursor-position-report replies', () => {
    expect(isXtermAutoReply('\x1b[1;1R')).toBe(true);
    expect(isXtermAutoReply('\x1b[24;80R')).toBe(true);
    expect(isXtermAutoReply('\x1b[120;200R')).toBe(true);
  });

  it('does not match a plain printable character', () => {
    expect(isXtermAutoReply('x')).toBe(false);
    expect(isXtermAutoReply('hello')).toBe(false);
    expect(isXtermAutoReply('?1;2c')).toBe(false); // tail without the leading ESC[
  });

  it('does not match empty input', () => {
    expect(isXtermAutoReply('')).toBe(false);
  });

  it('does not match a partial match with surrounding bytes', () => {
    // Real user input that *contains* a DA1 shape must NOT be filtered.
    // xterm.js emits replies as atomic onData calls — we require an exact
    // match on the whole string.
    expect(isXtermAutoReply('hi\x1b[?1;2c')).toBe(false);
    expect(isXtermAutoReply('\x1b[?1;2cextra')).toBe(false);
  });

  it('does not match common ESC sequences that are NOT auto-replies', () => {
    // CSI cursor up — user-typed Ctrl+arrow or app-emitted sequence
    expect(isXtermAutoReply('\x1b[A')).toBe(false);
    // CSI ESC O — function key
    expect(isXtermAutoReply('\x1bOH')).toBe(false);
    // Bracketed paste start
    expect(isXtermAutoReply('\x1b[200~')).toBe(false);
    // OSC sequences
    expect(isXtermAutoReply('\x1b]0;title\x07')).toBe(false);
  });

  it('does not match malformed reply-shaped sequences', () => {
    // Wrong final byte
    expect(isXtermAutoReply('\x1b[?1;2x')).toBe(false);
    // Missing prefix
    expect(isXtermAutoReply('[?1;2c')).toBe(false);
    // Letters where digits should be
    expect(isXtermAutoReply('\x1b[?a;2c')).toBe(false);
  });
});
