import { describe, expect, it } from 'vitest';
import type { BlueprintCatalogEntry } from '@shared/types';
import {
  NO_BLUEPRINT_FILTERS,
  blueprintCategories,
  countOwned,
  filterBlueprints,
  isOwned,
  metaGroupLabel,
  sortBlueprints,
} from '@renderer/lib/blueprintView';

function entry(overrides: Partial<BlueprintCatalogEntry> & { typeId: number; name: string }): BlueprintCatalogEntry {
  return {
    productTypeId: null,
    groupName: 'Frigate',
    categoryName: 'Ship',
    metaGroupId: 1,
    marketSeeded: true,
    activity: 'manufacturing',
    originals: 0,
    copies: 0,
    holders: [],
    bestMaterialEfficiency: null,
    bestTimeEfficiency: null,
    ...overrides,
  };
}

const RIFTER = entry({
  typeId: 683,
  name: 'Rifter Blueprint',
  originals: 1,
  bestMaterialEfficiency: 10,
  bestTimeEfficiency: 20,
  holders: [
    { kind: 'corporation', id: 98_000_001, name: 'Alt Corp', materialEfficiency: 10, timeEfficiency: 20 },
  ],
});
const BANTAM = entry({ typeId: 681, name: 'Bantam Blueprint', categoryName: 'Ship' });
const WOLF = entry({
  typeId: 11372,
  name: 'Wolf Blueprint',
  metaGroupId: 2,
  categoryName: 'Ship',
});
const COMET = entry({
  typeId: 17842,
  name: 'Federation Navy Comet Blueprint',
  metaGroupId: 4,
  marketSeeded: false,
});
const CHARGE = entry({
  typeId: 900,
  name: 'Scourge Rocket Blueprint',
  categoryName: 'Charge',
  groupName: 'Rocket',
});

/** Held only as copies — a stack of BPCs, no original. */
const COPIES_ONLY = entry({
  typeId: 605,
  name: 'Heron Blueprint',
  originals: 0,
  copies: 4,
});

const ALL = [RIFTER, BANTAM, WOLF, COMET, CHARGE];

describe('isOwned', () => {
  it('ticks a blueprint you hold an original of', () => {
    expect(isOwned(RIFTER, true)).toBe(true);
  });

  it('never ticks a pile of copies while originals-only is on', () => {
    // This is what makes it a BPO checklist rather than a hangar inventory.
    expect(isOwned(COPIES_ONLY, true)).toBe(false);
  });

  it('ticks copies once originals-only is turned off', () => {
    expect(isOwned(COPIES_ONLY, false)).toBe(true);
  });

  it('never ticks a blueprint nobody holds, either way', () => {
    expect(isOwned(BANTAM, true)).toBe(false);
    expect(isOwned(BANTAM, false)).toBe(false);
  });
});

describe('countOwned', () => {
  const entries = [RIFTER, BANTAM, COPIES_ONLY, COMET];

  it('counts originals against the market-seeded denominator by default', () => {
    // COMET is copy-only so it is out of the denominator entirely; COPIES_ONLY
    // is in it, but held only as copies, so it does not count as owned.
    expect(countOwned(entries, { includeCopyOnly: false, originalsOnly: true })).toEqual({
      owned: 1,
      total: 3,
    });
  });

  it('counts copies as owned when originals-only is off', () => {
    expect(countOwned(entries, { includeCopyOnly: false, originalsOnly: false })).toEqual({
      owned: 2,
      total: 3,
    });
  });

  it('widens the denominator when copy-only blueprints are shown', () => {
    expect(countOwned(entries, { includeCopyOnly: true, originalsOnly: true })).toEqual({
      owned: 1,
      total: 4,
    });
  });
});

describe('filterBlueprints', () => {
  it('hides copy-only blueprints by default', () => {
    // A faction BPC drop can never be ticked off, so it is not part of the
    // checklist until the user asks to see it.
    const visible = filterBlueprints(ALL, NO_BLUEPRINT_FILTERS);
    expect(visible.map((e) => e.typeId)).not.toContain(COMET.typeId);
    expect(visible).toHaveLength(4);
  });

  it('includes copy-only blueprints when asked', () => {
    const visible = filterBlueprints(ALL, { ...NO_BLUEPRINT_FILTERS, includeCopyOnly: true });
    expect(visible).toHaveLength(5);
  });

  it('filters by ownership', () => {
    expect(
      filterBlueprints(ALL, { ...NO_BLUEPRINT_FILTERS, ownership: 'owned' }).map((e) => e.typeId),
    ).toEqual([RIFTER.typeId]);
    expect(
      filterBlueprints(ALL, { ...NO_BLUEPRINT_FILTERS, ownership: 'missing' }).map((e) => e.typeId),
    ).toEqual([BANTAM.typeId, WOLF.typeId, CHARGE.typeId]);
  });

  it('agrees with the check mark about what "owned" means', () => {
    // A copies-only blueprint is missing while originals-only is on, and owned
    // once it is off — the filter must not contradict the tick beside it.
    const withCopies = [RIFTER, COPIES_ONLY];
    const owned = (originalsOnly: boolean): number[] =>
      filterBlueprints(withCopies, {
        ...NO_BLUEPRINT_FILTERS,
        ownership: 'owned',
        originalsOnly,
      }).map((e) => e.typeId);

    expect(owned(true)).toEqual([RIFTER.typeId]);
    expect(owned(false)).toEqual([RIFTER.typeId, COPIES_ONLY.typeId]);
  });

  it('filters by category', () => {
    const visible = filterBlueprints(ALL, { ...NO_BLUEPRINT_FILTERS, category: 'Charge' });
    expect(visible.map((e) => e.typeId)).toEqual([CHARGE.typeId]);
  });

  it('searches name, group and holder', () => {
    const search = (needle: string): number[] =>
      filterBlueprints(ALL, { ...NO_BLUEPRINT_FILTERS, search: needle }).map((e) => e.typeId);

    expect(search('rifter')).toEqual([RIFTER.typeId]);
    expect(search('rocket')).toEqual([CHARGE.typeId]);
    // Finding "everything my alt corp holds" is the whole point of the feature.
    expect(search('alt corp')).toEqual([RIFTER.typeId]);
  });
});

describe('sortBlueprints', () => {
  it('sorts by name, and ties always fall back to name', () => {
    const sorted = sortBlueprints(ALL, { key: 'category', dir: 'asc' });
    expect(sorted.map((e) => e.name)).toEqual([
      'Scourge Rocket Blueprint',
      'Bantam Blueprint',
      'Federation Navy Comet Blueprint',
      'Rifter Blueprint',
      'Wolf Blueprint',
    ]);
  });

  it('sorts unresearched and unowned blueprints below researched ones', () => {
    const sorted = sortBlueprints([BANTAM, RIFTER], { key: 'me', dir: 'desc' });
    expect(sorted.map((e) => e.typeId)).toEqual([RIFTER.typeId, BANTAM.typeId]);
  });

  it('does not mutate the input', () => {
    const input = [WOLF, BANTAM];
    sortBlueprints(input, { key: 'name', dir: 'asc' });
    expect(input.map((e) => e.typeId)).toEqual([WOLF.typeId, BANTAM.typeId]);
  });
});

describe('blueprintCategories', () => {
  it('returns the distinct category names, sorted', () => {
    expect(blueprintCategories(ALL)).toEqual(['Charge', 'Ship']);
  });
});

describe('metaGroupLabel', () => {
  it('reads a missing meta group as Tech I', () => {
    // Most Tech I items carry no metaGroupID at all in the SDE.
    expect(metaGroupLabel(null)).toBe('Tech I');
    expect(metaGroupLabel(1)).toBe('Tech I');
  });

  it('names the tiers a blueprint collection actually runs into', () => {
    expect(metaGroupLabel(2)).toBe('Tech II');
    expect(metaGroupLabel(4)).toBe('Faction');
    expect(metaGroupLabel(54)).toBe('Structure Tech I');
  });

  it('falls back to the raw id for a tier it has never heard of', () => {
    expect(metaGroupLabel(99)).toBe('Meta 99');
  });
});
