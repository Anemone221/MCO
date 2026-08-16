import { describe, expect, it } from 'vitest';
import type { ShipInfo } from '@shared/types';
import { filterShipGroups, groupShips } from '@renderer/lib/shipBrowser';

function ship(
  shipTypeId: number,
  name: string,
  group: [number, string],
  requirements: Array<{ skillTypeId: number; level: number }> = [],
): ShipInfo {
  return { shipTypeId, name, groupId: group[0], groupName: group[1], requirements };
}

const FRIGATE: [number, string] = [25, 'Frigate'];
const MARAUDER: [number, string] = [900, 'Marauder'];

const CATALOG: ShipInfo[] = [
  ship(587, 'Rifter', FRIGATE, [{ skillTypeId: 3331, level: 1 }]),
  ship(582, 'Bantam', FRIGATE),
  ship(28659, 'Paladin', MARAUDER, [
    { skillTypeId: 3339, level: 5 },
    { skillTypeId: 12096, level: 1 },
  ]),
  ship(28661, 'Golem', MARAUDER),
  // A hull the SDE has no group for is not browsable.
  { ...ship(1, 'Orphan', FRIGATE), groupId: null },
];

describe('groupShips', () => {
  const groups = groupShips(CATALOG);

  it('buckets hulls by ship group, both alphabetical', () => {
    expect(groups.map((g) => g.name)).toEqual(['Frigate', 'Marauder']);
    expect(groups[0]!.ships.map((s) => s.name)).toEqual(['Bantam', 'Rifter']);
    expect(groups[1]!.ships.map((s) => s.name)).toEqual(['Golem', 'Paladin']);
  });

  it('leaves out a hull with no group', () => {
    expect(groups.flatMap((g) => g.ships).map((s) => s.name)).not.toContain('Orphan');
  });

  it('carries each hull\'s skill requirements', () => {
    const paladin = groups[1]!.ships.find((s) => s.name === 'Paladin');

    expect(paladin?.requirements).toEqual([
      { skillTypeId: 3339, level: 5 },
      { skillTypeId: 12096, level: 1 },
    ]);
  });
});

describe('filterShipGroups', () => {
  const groups = groupShips(CATALOG);

  it('returns everything for an empty search', () => {
    expect(filterShipGroups(groups, '   ')).toHaveLength(2);
  });

  it('matches hull names, case-insensitively', () => {
    const hits = filterShipGroups(groups, 'rif');

    expect(hits).toHaveLength(1);
    expect(hits[0]!.ships.map((s) => s.name)).toEqual(['Rifter']);
  });

  it('keeps a whole group when the group name matches', () => {
    const hits = filterShipGroups(groups, 'marauder');

    expect(hits[0]!.ships.map((s) => s.name)).toEqual(['Golem', 'Paladin']);
  });

  it('answers nothing when neither group nor hull matches', () => {
    expect(filterShipGroups(groups, 'titan')).toEqual([]);
  });
});
