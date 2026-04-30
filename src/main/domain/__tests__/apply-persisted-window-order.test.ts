import { describe, it, expect } from 'vitest';
import { applyPersistedWindowOrder } from '../apply-persisted-window-order';
import type { WindowSpec } from '../../domain/types';

const win = (index: number, name: string, active = false) => ({ index, name, active });
const spec = (name: string): WindowSpec => ({ name, kind: 'command' });

describe('applyPersistedWindowOrder', () => {
  it('reorders live windows to match the persisted order', () => {
    const result = applyPersistedWindowOrder(
      [win(0, 'A'), win(1, 'B', true), win(2, 'C')],
      [spec('C'), spec('A'), spec('B')],
    );
    expect(result.map((w) => w.name)).toEqual(['C', 'A', 'B']);
  });

  it('preserves active flag when reordering', () => {
    const result = applyPersistedWindowOrder(
      [win(0, 'A'), win(1, 'B', true), win(2, 'C')],
      [spec('C'), spec('A'), spec('B')],
    );
    expect(result.find((w) => w.name === 'B')?.active).toBe(true);
    expect(result.find((w) => w.name === 'A')?.active).toBe(false);
  });

  it('returns live order unchanged when persisted is empty', () => {
    const result = applyPersistedWindowOrder(
      [win(0, 'A'), win(1, 'B'), win(2, 'C')],
      [],
    );
    expect(result.map((w) => w.name)).toEqual(['A', 'B', 'C']);
  });

  it('appends live windows that are not in the persisted order', () => {
    const result = applyPersistedWindowOrder(
      [win(0, 'A'), win(1, 'B'), win(2, 'C')],
      [spec('B')],
    );
    expect(result.map((w) => w.name)).toEqual(['B', 'A', 'C']);
  });

  it('drops persisted names that are not in the live list', () => {
    const result = applyPersistedWindowOrder(
      [win(0, 'A'), win(1, 'B')],
      [spec('A'), spec('B'), spec('GHOST')],
    );
    expect(result.map((w) => w.name)).toEqual(['A', 'B']);
  });
});
