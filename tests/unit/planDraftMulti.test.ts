import { describe, expect, it } from 'vitest';
import type { NeuralAttributes, PlanDraftEntry } from '@shared/types';
import { BALANCED_ATTRIBUTES } from '@shared/training';
import { dropEntries, shiftEntries } from '@renderer/lib/planDraft';

const REMAP: NeuralAttributes = { ...BALANCED_ATTRIBUTES, intelligence: 27 };

function row(name: string, remap?: NeuralAttributes): PlanDraftEntry {
  const entry: PlanDraftEntry = { skillTypeId: name.charCodeAt(0), skillName: name, level: 1 };
  if (remap) entry.remapBefore = remap;
  return entry;
}

const names = (entries: PlanDraftEntry[]): string => entries.map((e) => e.skillName).join('');

describe('dropEntries', () => {
  const queue = ['A', 'B', 'C', 'D', 'E', 'F'].map((n) => row(n));

  it('moves a contiguous block down, keeping its order', () => {
    expect(names(dropEntries(queue, [1, 2], { index: 5, underRemap: false }))).toBe('ADEBCF');
  });

  it('moves a block to the end and to the top', () => {
    expect(names(dropEntries(queue, [0, 1], { index: 6, underRemap: false }))).toBe('CDEFAB');
    expect(names(dropEntries(queue, [4, 5], { index: 0, underRemap: false }))).toBe('EFABCD');
  });

  it('gathers a scattered selection at the drop point', () => {
    expect(names(dropEntries(queue, [0, 3, 5], { index: 2, underRemap: false }))).toBe('BADFCE');
  });

  it('returns the same rows when dropped onto itself', () => {
    const after = dropEntries(queue, [2, 3], { index: 3, underRemap: false });
    expect(after.every((entry, i) => entry === queue[i])).toBe(true);
  });

  it('hands a remap to the block when dropped under it', () => {
    const withRemap = [row('A'), row('B'), row('C', REMAP), row('D'), row('E')];
    const after = dropEntries(withRemap, [3, 4], { index: 2, underRemap: true });
    expect(names(after)).toBe('ABDEC');
    expect(after[2]!.remapBefore).toEqual(REMAP);
    expect(after[4]!.remapBefore).toBeUndefined();
  });

  it('keeps the remap on a moved row that carries one', () => {
    const withRemap = [row('A'), row('B', REMAP), row('C'), row('D')];
    const after = dropEntries(withRemap, [1, 2], { index: 4, underRemap: false });
    expect(names(after)).toBe('ADBC');
    expect(after[2]!.remapBefore).toEqual(REMAP);
  });
});

describe('shiftEntries', () => {
  const queue = ['A', 'B', 'C', 'D', 'E'].map((n) => row(n));

  it('shifts a block one step up and down', () => {
    expect(names(shiftEntries(queue, [2, 3], -1))).toBe('ACDBE');
    expect(names(shiftEntries(queue, [1, 2], 1))).toBe('ADBCE');
  });

  it('does nothing at the edge', () => {
    expect(names(shiftEntries(queue, [0, 1], -1))).toBe('ABCDE');
    expect(names(shiftEntries(queue, [3, 4], 1))).toBe('ABCDE');
  });
});
