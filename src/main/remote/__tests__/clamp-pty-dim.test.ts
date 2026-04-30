import { describe, it, expect } from 'vitest';
import { clampPtyDim } from '../clamp-pty-dim';

describe('clampPtyDim', () => {
  it('passes through valid integer dimensions', () => {
    expect(clampPtyDim(80, 80)).toBe(80);
    expect(clampPtyDim(173, 80)).toBe(173);
    expect(clampPtyDim(1, 80)).toBe(1);
    expect(clampPtyDim(1000, 80)).toBe(1000);
  });

  it('truncates fractional values to integers', () => {
    expect(clampPtyDim(80.7, 80)).toBe(80);
    expect(clampPtyDim(173.999, 80)).toBe(173);
  });

  it('falls back to default for non-finite numbers', () => {
    expect(clampPtyDim(NaN, 24)).toBe(24);
    expect(clampPtyDim(Infinity, 24)).toBe(24);
    expect(clampPtyDim(-Infinity, 24)).toBe(24);
  });

  it('falls back to default for zero and negative dimensions', () => {
    expect(clampPtyDim(0, 80)).toBe(80);
    expect(clampPtyDim(-1, 80)).toBe(80);
    expect(clampPtyDim(-9999, 80)).toBe(80);
  });

  it('caps oversized dimensions at the maximum (1000)', () => {
    expect(clampPtyDim(1001, 80)).toBe(80);
    expect(clampPtyDim(2 ** 31, 80)).toBe(80);
    expect(clampPtyDim(Number.MAX_SAFE_INTEGER, 80)).toBe(80);
  });

  it('coerces string-like inputs that parse to a valid number', () => {
    expect(clampPtyDim('120', 80)).toBe(120);
  });

  it('falls back to default for unparseable inputs', () => {
    expect(clampPtyDim('not-a-number', 80)).toBe(80);
    expect(clampPtyDim(null, 80)).toBe(80);
    expect(clampPtyDim(undefined, 80)).toBe(80);
    expect(clampPtyDim({}, 80)).toBe(80);
  });
});
