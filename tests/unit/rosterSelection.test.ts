import { describe, expect, it } from 'vitest';
import {
  clickSelection,
  headerSelection,
  resolveSelection,
  toggleAllVisible,
} from '../../src/renderer/src/lib/rosterSelection';

const VISIBLE = [10, 20, 30, 40, 50];
const sorted = (set: Set<number>): number[] => [...set].sort((a, b) => a - b);

describe('clickSelection', () => {
  it('flips one row on a plain click', () => {
    expect(sorted(clickSelection(new Set(), VISIBLE, 20, null, false))).toEqual([20]);
    expect(sorted(clickSelection(new Set([20, 30]), VISIBLE, 20, 30, false))).toEqual([30]);
  });

  it('selects the range from the anchor on a shift-click, in either direction', () => {
    expect(sorted(clickSelection(new Set([20]), VISIBLE, 40, 20, true))).toEqual([20, 30, 40]);
    expect(sorted(clickSelection(new Set([40]), VISIBLE, 10, 40, true))).toEqual([10, 20, 30, 40]);
  });

  it('clears the range when the shift-clicked row was selected', () => {
    const all = new Set(VISIBLE);
    expect(sorted(clickSelection(all, VISIBLE, 40, 20, true))).toEqual([10, 50]);
  });

  it('leaves rows outside the range alone', () => {
    expect(sorted(clickSelection(new Set([10, 20]), VISIBLE, 50, 40, true))).toEqual([
      10, 20, 40, 50,
    ]);
  });

  it('treats a shift-click as a plain click when the anchor is not on screen', () => {
    expect(sorted(clickSelection(new Set(), VISIBLE, 30, null, true))).toEqual([30]);
    expect(sorted(clickSelection(new Set([99]), VISIBLE, 30, 99, true))).toEqual([30, 99]);
  });

  it('follows the order on screen, not the order of ids', () => {
    expect(sorted(clickSelection(new Set(), [50, 10, 40, 20], 40, 50, true))).toEqual([
      10, 40, 50,
    ]);
  });
});

describe('headerSelection and toggleAllVisible', () => {
  it('reports none, some or all of the rows on screen', () => {
    expect(headerSelection(new Set(), VISIBLE)).toBe('none');
    expect(headerSelection(new Set([10, 99]), VISIBLE)).toBe('some');
    expect(headerSelection(new Set([...VISIBLE, 99]), VISIBLE)).toBe('all');
    expect(headerSelection(new Set([99]), [])).toBe('none');
  });

  it('selects every row on screen, keeping what was selected off screen', () => {
    expect(sorted(toggleAllVisible(new Set([10, 99]), VISIBLE))).toEqual([...VISIBLE, 99]);
  });

  it('clears the rows on screen when all of them are selected, and only those', () => {
    expect(sorted(toggleAllVisible(new Set([...VISIBLE, 99]), VISIBLE))).toEqual([99]);
  });
});

describe('resolveSelection', () => {
  it('returns the selection in roster order and counts what the filters hide', () => {
    expect(resolveSelection(new Set([40, 10, 30]), VISIBLE, [10, 20])).toEqual({
      ids: [10, 30, 40],
      hidden: 2,
    });
  });

  it('drops a character that no longer exists', () => {
    expect(resolveSelection(new Set([10, 99]), VISIBLE, VISIBLE)).toEqual({ ids: [10], hidden: 0 });
  });
});
