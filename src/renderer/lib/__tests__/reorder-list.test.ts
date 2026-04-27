import { describe, it, expect } from 'vitest';
import { reorderList } from '../reorder-list';

describe('reorderList', () => {
  it('moves the dragged id above the target when edge is "top"', () => {
    expect(reorderList(['a', 'b', 'c'], 'c', 'a', 'top')).toEqual(['c', 'a', 'b']);
  });

  it('moves the dragged id below the target when edge is "bottom"', () => {
    expect(reorderList(['a', 'b', 'c'], 'a', 'c', 'bottom')).toEqual(['b', 'c', 'a']);
  });

  it('moves the dragged id above an interior target', () => {
    expect(reorderList(['a', 'b', 'c', 'd'], 'd', 'b', 'top')).toEqual(['a', 'd', 'b', 'c']);
  });

  it('moves the dragged id below an interior target', () => {
    expect(reorderList(['a', 'b', 'c', 'd'], 'a', 'b', 'bottom')).toEqual(['b', 'a', 'c', 'd']);
  });

  it('keeps order stable when dropping above the same neighbour', () => {
    expect(reorderList(['a', 'b', 'c'], 'b', 'a', 'top')).toEqual(['b', 'a', 'c']);
  });

  it('returns the input untouched when the target id is not present', () => {
    expect(reorderList(['a', 'b', 'c'], 'a', 'z', 'top')).toEqual(['a', 'b', 'c']);
  });
});
