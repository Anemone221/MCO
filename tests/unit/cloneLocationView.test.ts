import { describe, expect, it } from 'vitest';
import type { CloneBoardEntry, JumpCloneEntry } from '@shared/types';
import {
  allClones,
  cloneLocationLabel,
  cloneLocations,
  clonesAtLocation,
} from '@renderer/lib/cloneLocationView';

function jc(jumpCloneId: number, locationName: string | null, locationId = 60000000 + jumpCloneId): JumpCloneEntry {
  return {
    jumpCloneId,
    name: null,
    locationId,
    locationType: 'station',
    locationName,
    implants: [],
    critical: false,
  };
}

function entry(
  characterId: number,
  characterName: string,
  clones: JumpCloneEntry[],
  overrides: Partial<CloneBoardEntry> = {},
): CloneBoardEntry {
  return {
    characterId,
    characterName,
    accountLabel: null,
    status: 'ok',
    missingScopes: [],
    activeImplants: [],
    activeCritical: false,
    clones,
    updatedAt: '2026-11-01T00:00:00Z',
    nextCloneJumpAt: null,
    medicalClone: null,
    ...overrides,
  };
}

const JITA = 'Jita IV - Moon 4 - Caldari Navy Assembly Plant';
const AMARR = 'Amarr VIII (Oris) - Emperor Family Academy';

describe('cloneLocationView', () => {
  it('labels unresolved locations by id', () => {
    expect(cloneLocationLabel({ locationId: 5, locationType: 'structure', locationName: null })).toBe(
      'Structure 5',
    );
    expect(cloneLocationLabel({ locationId: null, locationType: null, locationName: null })).toBe(
      'Unknown location',
    );
  });

  it('flattens jump and medical clones, skipping unsynced characters', () => {
    const board = [
      entry(1, 'Bravo', [jc(10, JITA)], {
        medicalClone: { locationId: 1, locationType: 'station', locationName: AMARR },
      }),
      entry(2, 'Alpha', [jc(20, JITA)], { status: 'scope-missing' }),
      entry(3, 'Charlie', [jc(30, JITA)], { updatedAt: null }),
    ];
    const rows = allClones(board);
    expect(rows.map((r) => [r.characterId, r.kind])).toEqual([
      [1, 'jump'],
      [1, 'medical'],
    ]);
  });

  it('matches a system name across stations, sorted by location then character', () => {
    const board = [
      entry(1, 'Bravo', [jc(10, JITA), jc(11, AMARR)]),
      entry(2, 'Alpha', [jc(20, JITA)], {
        medicalClone: { locationId: 1, locationType: 'station', locationName: JITA },
      }),
    ];
    const rows = clonesAtLocation(allClones(board), '  jita ');
    expect(rows.map((r) => [r.characterName, r.kind])).toEqual([
      ['Alpha', 'jump'],
      ['Alpha', 'medical'],
      ['Bravo', 'jump'],
    ]);
    expect(clonesAtLocation(allClones(board), '   ')).toEqual([]);
  });

  it('lists distinct locations busiest first', () => {
    const board = [entry(1, 'A', [jc(10, JITA), jc(11, AMARR)]), entry(2, 'B', [jc(20, JITA)])];
    expect(cloneLocations(allClones(board))).toEqual([
      { location: JITA, count: 2 },
      { location: AMARR, count: 1 },
    ]);
  });
});
