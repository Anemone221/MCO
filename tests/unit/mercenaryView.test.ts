import { describe, expect, it } from 'vitest';
import type { MercenaryDenEntry } from '@shared/types';
import {
  DEFAULT_MERCENARY_SORT,
  denLocation,
  denStatusChip,
  filterDens,
  formatMeter,
  nextMercenarySort,
  sortDens,
} from '@renderer/lib/mercenaryView';

function den(overrides: Partial<MercenaryDenEntry> = {}): MercenaryDenEntry {
  return {
    denId: 1,
    characterId: 100,
    characterName: 'Adam Alt',
    accountLabel: 'Account A',
    planetId: 40255188,
    planetName: 'F-YH5B VI',
    solarSystemId: 30004759,
    systemName: 'F-YH5B',
    regionName: 'Delve',
    security: -0.4,
    status: 'running',
    typeName: 'Mercenary Den',
    typeId: 85230,
    skyhookCorporationId: 98000001,
    skyhookCorporationName: 'Holding Corp',
    development: { amount: 50, level: 2 },
    anarchy: { amount: 10, level: 0 },
    infomorphs: 100,
    reinforcementEnd: null,
    operations: [],
    openOperations: 0,
    attention: 0,
    detailSyncedAt: '2026-08-28 11:00:00',
    updatedAt: '2026-08-28 11:00:00',
    ...overrides,
  };
}

describe('formatMeter', () => {
  it('shows the level and how far into it the den is', () => {
    expect(formatMeter({ amount: 45, level: 2 })).toBe('L2 · 45%');
  });

  it('renders an entirely unknown meter as the absent-value dash', () => {
    expect(formatMeter({ amount: null, level: null })).toBe('—');
  });

  it('shows whichever half is known', () => {
    expect(formatMeter({ amount: null, level: 3 })).toBe('L3');
    expect(formatMeter({ amount: 20, level: null })).toBe('20%');
  });

  it('keeps level 0 visible rather than reading it as absent', () => {
    expect(formatMeter({ amount: 0, level: 0 })).toBe('L0 · 0%');
  });
});

describe('denLocation', () => {
  it('prefers the resolved planet name', () => {
    expect(denLocation(den())).toBe('F-YH5B VI');
  });

  it('falls back to the system and the raw id while the lookup is pending', () => {
    expect(denLocation(den({ planetName: null }))).toBe('F-YH5B · planet 40255188');
  });

  it('still names the den when nothing has resolved', () => {
    expect(denLocation(den({ planetName: null, systemName: null }))).toBe('Planet 40255188');
  });
});

describe('denStatusChip', () => {
  it('leaves the routine case neutral', () => {
    // Most dens on a large roster are running; colouring them all would bury
    // the few that are not.
    expect(denStatusChip('running')).toContain('chip--idle');
  });

  it('gives a reinforcement the same blue as the in-game timer', () => {
    expect(denStatusChip('reinforced')).toContain('chip--fatigue');
  });

  it('marks a disabled den as a problem', () => {
    expect(denStatusChip('disabled')).toContain('chip--danger');
  });
});

describe('filterDens', () => {
  const dens = [
    den({ denId: 1, characterName: 'Adam Alt', systemName: 'F-YH5B' }),
    den({ denId: 2, characterName: 'Beta Alt', systemName: '1DQ1-A', planetName: '1DQ1-A IV' }),
  ];

  it('returns everything for an empty filter', () => {
    expect(filterDens(dens, '   ')).toHaveLength(2);
  });

  it('matches on character, system and account alike', () => {
    expect(filterDens(dens, 'beta').map((d) => d.denId)).toEqual([2]);
    expect(filterDens(dens, '1dq1').map((d) => d.denId)).toEqual([2]);
    expect(filterDens(dens, 'account a')).toHaveLength(2);
  });

  it('reaches into the operations a den is offering', () => {
    const withOp = den({
      denId: 3,
      operations: [
        {
          operationId: 'abc',
          denId: 3,
          status: 'available',
          dungeonName: 'Infomorph Extraction',
          dungeonTypeId: 12367,
          expires: null,
        },
      ],
    });
    expect(filterDens([...dens, withOp], 'infomorph').map((d) => d.denId)).toEqual([3]);
  });
});

describe('sortDens', () => {
  it('puts what needs attention first by default', () => {
    const rows = [den({ denId: 1, attention: 0 }), den({ denId: 2, attention: 4 })];
    expect(sortDens(rows, DEFAULT_MERCENARY_SORT).map((d) => d.denId)).toEqual([2, 1]);
  });

  it('orders the status column by urgency, not alphabetically', () => {
    const rows = [
      den({ denId: 1, status: 'running' }),
      den({ denId: 2, status: 'disabled' }),
      den({ denId: 3, status: 'reinforced' }),
    ];
    expect(sortDens(rows, { key: 'status', dir: 'desc' }).map((d) => d.denId)).toEqual([3, 2, 1]);
  });

  it('sorts a null meter below a real level 0', () => {
    const rows = [
      den({ denId: 1, anarchy: { amount: null, level: null } }),
      den({ denId: 2, anarchy: { amount: 0, level: 0 } }),
    ];
    expect(sortDens(rows, { key: 'anarchy', dir: 'asc' }).map((d) => d.denId)).toEqual([1, 2]);
  });

  it('keeps dens with no timer out of the way in both directions', () => {
    const rows = [
      den({ denId: 1, reinforcementEnd: null }),
      den({ denId: 2, reinforcementEnd: '2026-08-29T00:00:00Z' }),
    ];
    // Ascending puts the soonest deadline first; "no deadline" is not a 1970 one.
    expect(sortDens(rows, { key: 'timer', dir: 'asc' }).map((d) => d.denId)).toEqual([2, 1]);
  });

  it('is stable for rows that compare equal', () => {
    const rows = [
      den({ denId: 1, characterName: 'Zed', attention: 1 }),
      den({ denId: 2, characterName: 'Abe', attention: 1 }),
    ];
    const sorted = sortDens(rows, { key: 'infomorphs', dir: 'desc' });
    expect(sorted.map((d) => d.denId)).toEqual([2, 1]);
  });
});

describe('nextMercenarySort', () => {
  it('starts names A→Z and measurements biggest-first', () => {
    expect(nextMercenarySort(DEFAULT_MERCENARY_SORT, 'character').dir).toBe('asc');
    expect(nextMercenarySort(DEFAULT_MERCENARY_SORT, 'anarchy').dir).toBe('desc');
  });

  it('flips the direction when the same column is clicked again', () => {
    const first = nextMercenarySort(DEFAULT_MERCENARY_SORT, 'anarchy');
    expect(nextMercenarySort(first, 'anarchy').dir).toBe('asc');
  });
});
