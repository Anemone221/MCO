import { describe, expect, it } from 'vitest';
import type { MiningSummary } from '@shared/types';
import {
  DEFAULT_MINING_SORT,
  barColumn,
  barPercent,
  filterMiningRows,
  miningColumns,
  miningMetric,
  miningRows,
  nextMiningSort,
  sortMiningRows,
} from '@renderer/lib/miningView';

function summary(overrides: Partial<MiningSummary> = {}): MiningSummary {
  return {
    window: { startDay: '2026-07-22', endDay: '2026-08-20', days: 30 },
    totals: { units: 0, volumeM3: 0, oreTypes: 0, characters: 0, systems: 0 },
    byDay: [],
    byCharacter: [],
    byOre: [],
    bySystem: [],
    typesMissingVolume: 0,
    coverage: [],
    reportingCharacters: 0,
    firstRecordedDay: null,
    ...overrides,
  };
}

const MINERS = summary({
  totals: { units: 3_000, volumeM3: 900, oreTypes: 2, characters: 2, systems: 1 },
  byCharacter: [
    {
      characterId: 1,
      characterName: 'Bex Voss',
      accountLabel: 'Account Alpha',
      units: 2_000,
      volumeM3: 600,
      oreTypes: 2,
      systems: 1,
      lastMinedDay: '2026-08-09',
    },
    {
      characterId: 2,
      characterName: 'Avira Adare',
      accountLabel: null,
      units: 1_000,
      volumeM3: 300,
      oreTypes: 1,
      systems: 1,
      lastMinedDay: '2026-08-20',
    },
  ],
});

describe('miningRows', () => {
  it('carries the character id, so the row links and takes the tag menu', () => {
    const rows = miningRows(MINERS, 'character');

    expect(rows.map((r) => r.characterId)).toEqual([1, 2]);
    expect(rows[0]).toMatchObject({ label: 'Bex Voss', sublabel: 'Account Alpha', countA: 2 });
  });

  it('names an ore the SDE has not imported by its type id rather than blank', () => {
    const rows = miningRows(
      summary({
        byOre: [
          {
            typeId: 17471,
            typeName: null,
            groupName: null,
            unitVolumeM3: null,
            units: 10,
            volumeM3: 0,
            characters: 1,
          },
        ],
      }),
      'ore',
    );

    expect(rows[0]?.label).toBe('Type 17471');
  });

  it('says an ore has no SDE volume instead of showing 0 m³ per unit', () => {
    const rows = miningRows(
      summary({
        byOre: [
          {
            typeId: 1230,
            typeName: 'Veldspar',
            groupName: 'Veldspar',
            unitVolumeM3: null,
            units: 10,
            volumeM3: 0,
            characters: 1,
          },
        ],
      }),
      'ore',
    );

    expect(rows[0]?.extra?.text).toBe('—');
  });

  it('keeps the security of a system row, for the colour tier', () => {
    const rows = miningRows(
      summary({
        bySystem: [
          {
            solarSystemId: 30000142,
            systemName: 'Jita',
            security: 0.9,
            regionName: 'The Forge',
            units: 1,
            volumeM3: 1,
            characters: 1,
          },
        ],
      }),
      'system',
    );

    expect(rows[0]).toMatchObject({ security: 0.9, sublabel: 'The Forge' });
  });
});

describe('sortMiningRows', () => {
  const rows = miningRows(MINERS, 'character');

  it('defaults to the biggest haul first', () => {
    expect(sortMiningRows(rows, DEFAULT_MINING_SORT).map((r) => r.label)).toEqual([
      'Bex Voss',
      'Avira Adare',
    ]);
  });

  it('sorts names alphabetically, case-insensitively', () => {
    expect(sortMiningRows(rows, { key: 'label', dir: 'asc' }).map((r) => r.label)).toEqual([
      'Avira Adare',
      'Bex Voss',
    ]);
  });

  it('orders days as dates, not as text', () => {
    // "2026-08-09" sorts after "2026-08-20" as a string only if the compare is
    // wrong; the row's numeric sort value is what makes this right.
    expect(sortMiningRows(rows, { key: 'extra', dir: 'desc' }).map((r) => r.label)).toEqual([
      'Avira Adare',
      'Bex Voss',
    ]);
  });

  it('breaks ties on volume so equal counts still read biggest-first', () => {
    const sorted = sortMiningRows(rows, { key: 'countB', dir: 'desc' });

    // Both characters mined in exactly one system.
    expect(sorted.map((r) => r.label)).toEqual(['Bex Voss', 'Avira Adare']);
  });

  it('leaves the input untouched', () => {
    const before = rows.map((r) => r.label);
    sortMiningRows(rows, { key: 'label', dir: 'asc' });

    expect(rows.map((r) => r.label)).toEqual(before);
  });
});

describe('filterMiningRows', () => {
  const rows = miningRows(MINERS, 'character');

  it('matches the account column as well as the name', () => {
    expect(filterMiningRows(rows, 'alpha').map((r) => r.label)).toEqual(['Bex Voss']);
  });

  it('returns everything for an empty search', () => {
    expect(filterMiningRows(rows, '   ')).toHaveLength(2);
  });
});

describe('nextMiningSort', () => {
  it('flips direction when the same column is clicked again', () => {
    expect(nextMiningSort({ key: 'volume', dir: 'desc' }, 'volume')).toEqual({
      key: 'volume',
      dir: 'asc',
    });
  });

  it('starts names ascending and numbers descending', () => {
    expect(nextMiningSort(DEFAULT_MINING_SORT, 'label').dir).toBe('asc');
    expect(nextMiningSort(DEFAULT_MINING_SORT, 'units').dir).toBe('desc');
  });
});

describe('miningColumns', () => {
  it('keeps volume and units in the same place in every breakdown', () => {
    for (const breakdown of ['character', 'ore', 'system'] as const) {
      const keys = miningColumns(breakdown).map((c) => c.key);
      expect(keys.slice(0, 4)).toEqual(['label', 'sublabel', 'volume', 'units']);
    }
  });

  it('gives systems no second count or extra column', () => {
    expect(miningColumns('system').map((c) => c.key)).toEqual([
      'label',
      'sublabel',
      'volume',
      'units',
      'countA',
    ]);
  });

  it('drops the volume column in the units fallback rather than duplicating the count', () => {
    const keys = miningColumns('character', 'units').map((c) => c.key);

    expect(keys).not.toContain('volume');
    expect(keys).toContain('units');
  });
});

describe('barColumn', () => {
  it('puts the share bar on whichever column the page measures in', () => {
    expect(barColumn('volume')).toBe('volume');
    expect(barColumn('units')).toBe('units');
  });
});

describe('miningMetric', () => {
  it('reads in m³ when the SDE knows the volumes', () => {
    expect(miningMetric(MINERS)).toBe('volume');
  });

  it('falls back to units when an old SDE leaves every volume at zero', () => {
    const noVolumes = summary({
      totals: { units: 5_000, volumeM3: 0, oreTypes: 1, characters: 1, systems: 1 },
      typesMissingVolume: 1,
    });

    expect(miningMetric(noVolumes)).toBe('units');
  });

  it('stays in m³ when there is simply nothing mined', () => {
    expect(miningMetric(summary())).toBe('volume');
  });
});

describe('barPercent', () => {
  it('measures a row against the biggest one', () => {
    expect(barPercent(250, 1_000)).toBe(25);
  });

  it('is zero rather than infinite when nothing was mined', () => {
    expect(barPercent(0, 0)).toBe(0);
  });
});
