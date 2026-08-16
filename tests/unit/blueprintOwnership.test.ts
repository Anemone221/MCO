import { describe, expect, it } from 'vitest';
import {
  buildOwnership,
  holderKey,
  ORIGINAL_QUANTITY,
  type CatalogInput,
  type HoldingInput,
} from '@main/blueprints/ownership';

function catalogEntry(overrides: Partial<CatalogInput> & { typeId: number }): CatalogInput {
  return {
    name: `Blueprint ${overrides.typeId}`,
    productTypeId: overrides.typeId + 1000,
    groupName: 'Frigate',
    categoryName: 'Ship',
    metaGroupId: 1,
    marketSeeded: true,
    activity: 'manufacturing',
    ...overrides,
  };
}

let nextItemId = 1;
function holding(overrides: Partial<HoldingInput> & { typeId: number }): HoldingInput {
  return {
    itemId: nextItemId++,
    quantity: ORIGINAL_QUANTITY,
    materialEfficiency: 0,
    timeEfficiency: 0,
    holderKind: 'character',
    holderId: 1,
    holderName: 'Pilot One',
    ...overrides,
  };
}

describe('buildOwnership', () => {
  it('ticks a blueprint only for originals, never for copies', () => {
    const { entries } = buildOwnership(
      [catalogEntry({ typeId: 683 }), catalogEntry({ typeId: 684 })],
      [
        holding({ typeId: 683 }),
        // -2 is a single copy; a positive quantity is a stack of that many.
        holding({ typeId: 684, quantity: -2 }),
        holding({ typeId: 684, quantity: 5 }),
      ],
    );

    const owned = entries.find((e) => e.typeId === 683)!;
    const copiesOnly = entries.find((e) => e.typeId === 684)!;
    expect(owned.originals).toBe(1);
    expect(owned.copies).toBe(0);
    expect(copiesOnly.originals).toBe(0);
    expect(copiesOnly.copies).toBe(6);
  });

  it('counts an item once even if it shows up under two holders', () => {
    // A blueprint moved into the corp hangar sits in both tables until the
    // character it left next syncs.
    const shared = { itemId: 42, typeId: 683 };
    const { entries } = buildOwnership(
      [catalogEntry({ typeId: 683 })],
      [
        holding({ ...shared, holderKind: 'character', holderId: 7, holderName: 'Pilot Seven' }),
        holding({ ...shared, holderKind: 'corporation', holderId: 98_000_001, holderName: 'Alt Corp' }),
      ],
    );

    expect(entries[0]!.originals).toBe(1);
    expect(entries[0]!.holders).toHaveLength(1);
  });

  it('lists every distinct holder of a blueprint, sorted by name', () => {
    const { entries } = buildOwnership(
      [catalogEntry({ typeId: 683 })],
      [
        holding({ typeId: 683, holderId: 2, holderName: 'Zeta Pilot' }),
        holding({
          typeId: 683,
          holderKind: 'corporation',
          holderId: 98_000_001,
          holderName: 'Alt Corp',
        }),
      ],
    );

    expect(entries[0]!.originals).toBe(2);
    expect(entries[0]!.holders.map((h) => h.name)).toEqual(['Alt Corp', 'Zeta Pilot']);
  });

  it('reports the best research levels held, and null when unowned', () => {
    const { entries } = buildOwnership(
      [catalogEntry({ typeId: 683 }), catalogEntry({ typeId: 684 })],
      [
        holding({ typeId: 683, materialEfficiency: 4, timeEfficiency: 10 }),
        holding({ typeId: 683, materialEfficiency: 10, timeEfficiency: 2 }),
        // A copy's research levels must not count as a researched original.
        holding({ typeId: 684, quantity: -2, materialEfficiency: 10, timeEfficiency: 20 }),
      ],
    );

    const researched = entries.find((e) => e.typeId === 683)!;
    expect(researched.bestMaterialEfficiency).toBe(10);
    expect(researched.bestTimeEfficiency).toBe(10);

    const copyOnly = entries.find((e) => e.typeId === 684)!;
    expect(copyOnly.bestMaterialEfficiency).toBeNull();
    expect(copyOnly.bestTimeEfficiency).toBeNull();
  });

  it('separates the market-seeded denominator from the full catalog', () => {
    const { totals } = buildOwnership(
      [
        catalogEntry({ typeId: 1 }),
        catalogEntry({ typeId: 2 }),
        // Copy-only: exists as a BPC and can never be ticked off.
        catalogEntry({ typeId: 3, marketSeeded: false }),
      ],
      [holding({ typeId: 1 })],
    );

    // How many are *owned* is not here: that depends on the page's toggles, so
    // it is counted next to them (countOwned in lib/blueprintView.ts).
    expect(totals).toMatchObject({ seededTotal: 2, allTotal: 3 });
  });

  it('counts held originals outside the catalog rather than inventing rows for them', () => {
    const { entries, totals } = buildOwnership(
      [catalogEntry({ typeId: 683 })],
      [holding({ typeId: 683 }), holding({ typeId: 2748 })],
    );

    expect(entries).toHaveLength(1);
    expect(totals.untracked).toBe(1);
  });

  it('tallies originals per holder for the coverage strip', () => {
    const { originalsByHolder } = buildOwnership(
      [catalogEntry({ typeId: 683 }), catalogEntry({ typeId: 684 })],
      [
        holding({ typeId: 683, holderId: 7, holderName: 'Pilot Seven' }),
        holding({ typeId: 684, holderId: 7, holderName: 'Pilot Seven' }),
        holding({
          typeId: 684,
          holderKind: 'corporation',
          holderId: 98_000_001,
          holderName: 'Alt Corp',
        }),
        // Off-catalog originals still belong to whoever holds them.
        holding({ typeId: 2748, holderId: 7, holderName: 'Pilot Seven' }),
      ],
    );

    expect(originalsByHolder.get(holderKey('character', 7))).toBe(3);
    expect(originalsByHolder.get(holderKey('corporation', 98_000_001))).toBe(1);
  });

  it('returns an empty board rather than throwing when nothing is imported', () => {
    const { entries, totals } = buildOwnership([], []);
    expect(entries).toEqual([]);
    expect(totals).toEqual({ seededTotal: 0, allTotal: 0, untracked: 0 });
  });
});
