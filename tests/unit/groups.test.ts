import { describe, expect, it } from 'vitest';
import type { CharacterGroup } from '@shared/types';
import { filterByGroup, memberIdSet } from '@renderer/lib/groups';

function group(id: number, name: string, characterIds: number[]): CharacterGroup {
  return {
    id,
    name,
    color: null,
    characterIds,
    priorityFitId: null,
    priorityPlanId: null,
    homeStationId: null,
    homeStationName: null,
    podSystems: [],
  };
}

const GROUPS: CharacterGroup[] = [
  group(1, 'WH defense', [10, 20, 30]),
  group(2, 'PVP toons', [20, 40]),
  group(3, 'Empty', []),
];

describe('memberIdSet', () => {
  it('returns null for "all" (no filtering)', () => {
    expect(memberIdSet(GROUPS, 'all')).toBeNull();
  });

  it('returns the member ids of the selected group', () => {
    expect(memberIdSet(GROUPS, 1)).toEqual(new Set([10, 20, 30]));
  });

  it('returns an empty set for a group with no members', () => {
    expect(memberIdSet(GROUPS, 3)).toEqual(new Set());
  });

  it('returns null when the selected group no longer exists', () => {
    expect(memberIdSet(GROUPS, 999)).toBeNull();
  });
});

describe('filterByGroup', () => {
  const entries = [
    { characterId: 10, characterName: 'A' },
    { characterId: 20, characterName: 'B' },
    { characterId: 40, characterName: 'D' },
  ];

  it('passes everything through when the id set is null', () => {
    expect(filterByGroup(entries, null)).toEqual(entries);
  });

  it('keeps only entries whose characterId is a member', () => {
    const ids = memberIdSet(GROUPS, 1);
    expect(filterByGroup(entries, ids).map((e) => e.characterId)).toEqual([10, 20]);
  });

  it('drops everyone for a group with no members', () => {
    const ids = memberIdSet(GROUPS, 3);
    expect(filterByGroup(entries, ids)).toEqual([]);
  });
});
