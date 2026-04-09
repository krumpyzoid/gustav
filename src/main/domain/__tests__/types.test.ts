import { describe, it, expect } from 'vitest';
import { worstStatus } from '../types';
import type { ClaudeStatus } from '../types';

describe('worstStatus', () => {
  it('returns none for empty array', () => {
    expect(worstStatus([])).toBe('none');
  });

  it('returns the single status when array has one element', () => {
    expect(worstStatus(['busy'])).toBe('busy');
  });

  it('ranks action as worst', () => {
    expect(worstStatus(['done', 'busy', 'action', 'new'])).toBe('action');
  });

  it('ranks busy above done and new', () => {
    expect(worstStatus(['done', 'new', 'busy'])).toBe('busy');
  });

  it('ranks done above new', () => {
    expect(worstStatus(['new', 'done', 'none'])).toBe('done');
  });

  it('ranks new above none', () => {
    expect(worstStatus(['none', 'new'])).toBe('new');
  });

  it('returns none when all statuses are none', () => {
    expect(worstStatus(['none', 'none'])).toBe('none');
  });

  it('handles duplicates correctly', () => {
    expect(worstStatus(['busy', 'busy', 'done'])).toBe('busy');
  });
});
