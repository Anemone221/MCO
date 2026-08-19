import { describe, expect, it } from 'vitest';
import type { NearestCharacterEntry, NearestCloneOption } from '@shared/types';
import {
  bestRoute,
  cloneJumpOnCooldown,
  cloneLabel,
  formatJumps,
  formatLightYears,
  sortNearest,
} from '@renderer/lib/nearestView';

function clone(
  jumpCloneId: number,
  jumps: number | null,
  lightYears: number | null,
  overrides: Partial<NearestCloneOption> = {},
): NearestCloneOption {
  return {
    jumpCloneId,
    name: null,
    locationName: null,
    systemId: 30000000 + jumpCloneId,
    systemName: `System ${jumpCloneId}`,
    security: 0.5,
    regionName: 'Somewhere',
    jumps,
    lightYears,
    ...overrides,
  };
}

/** Character ids are unique in EVE; a fixture that reused one would test nothing. */
let nextCharacterId = 90_000_000;

function entry(
  characterName: string,
  jumps: number | null,
  lightYears: number | null,
  clones: NearestCloneOption[] = [],
  cloneJumpReadyAt: string | null = null,
): NearestCharacterEntry {
  return {
    characterId: (nextCharacterId += 1),
    characterName,
    accountLabel: null,
    systemId: 30000142,
    systemName: 'Jita',
    security: 0.9,
    regionId: 10000002,
    regionName: 'The Forge',
    docked: false,
    dockedName: null,
    shipName: null,
    shipTypeName: null,
    updatedAt: null,
    jumps,
    lightYears,
    tagNames: [],
    clones,
    cloneJumpReadyAt,
  };
}

describe('bestRoute', () => {
  it('is the character’s own position when it has no clones', () => {
    const route = bestRoute(entry('Solo', 7, 3), 'jumps');

    expect(route).toEqual({ via: 'location', clone: null, jumps: 7, lightYears: 3 });
  });

  it('takes a clone that is closer than flying', () => {
    const route = bestRoute(entry('Jumper', 30, 12, [clone(1, 2, 0.6)]), 'jumps');

    expect(route.via).toBe('clone');
    expect(route.jumps).toBe(2);
    expect(route.lightYears).toBe(0.6);
    expect(route.clone?.jumpCloneId).toBe(1);
  });

  it('ignores clones that are further away than the character already is', () => {
    const route = bestRoute(entry('Home', 3, 1, [clone(1, 20, 8)]), 'jumps');

    expect(route.via).toBe('location');
    expect(route.jumps).toBe(3);
  });

  it('keeps the character in place on a tie — a clone jump has to earn it', () => {
    // Same distance either way: jumping would cost the ship and the cooldown
    // for nothing.
    const route = bestRoute(entry('Tied', 4, 2, [clone(1, 4, 2)]), 'jumps');

    expect(route.via).toBe('location');
  });

  it('picks by the metric being ranked, not always by jumps', () => {
    // One clone is nearer by gates, the other nearer in light years — which is
    // "best" depends entirely on whether the character flies or a capital jumps.
    const candidate = entry('Split', 40, 30, [clone(1, 5, 20), clone(2, 12, 1.5)]);

    expect(bestRoute(candidate, 'jumps').clone?.jumpCloneId).toBe(1);
    expect(bestRoute(candidate, 'lightYears').clone?.jumpCloneId).toBe(2);
  });

  it('uses a clone with a gate route when the character itself has none', () => {
    // Parked in a wormhole, but with a clone back in known space.
    const route = bestRoute(entry('Wormhole', null, null, [clone(1, 6, 4)]), 'jumps');

    expect(route.via).toBe('clone');
    expect(route.jumps).toBe(6);
  });
});

describe('sortNearest', () => {
  it('ranks by gate jumps, nearest first', () => {
    const sorted = sortNearest(
      [entry('Far', 12, 1), entry('Here', 0, 40), entry('Near', 3, 9)],
      'jumps',
    );

    expect(sorted.map((e) => e.characterName)).toEqual(['Here', 'Near', 'Far']);
  });

  it('ranks by light years when that is the metric', () => {
    // Reverse of the jump order: a system a light year away can be a long
    // gate trip, which is exactly why both metrics exist.
    const sorted = sortNearest(
      [entry('Far', 12, 1), entry('Here', 0, 40), entry('Near', 3, 9)],
      'lightYears',
    );

    expect(sorted.map((e) => e.characterName)).toEqual(['Far', 'Near', 'Here']);
  });

  it('ranks a character through its jump clone', () => {
    const sorted = sortNearest(
      [entry('Flying', 6, 3), entry('Cloned', 40, 30, [clone(1, 1, 0.5)])],
      'jumps',
    );

    expect(sorted.map((e) => e.characterName)).toEqual(['Cloned', 'Flying']);
  });

  it('sinks unmeasurable distances below every measured one', () => {
    const sorted = sortNearest([entry('NoRoute', null, 2), entry('Long', 40, 30)], 'jumps');

    expect(sorted.map((e) => e.characterName)).toEqual(['Long', 'NoRoute']);
  });

  it('breaks ties on the other metric, then the name', () => {
    const sorted = sortNearest(
      [entry('Zoe', 4, 3), entry('Adam', 4, 3), entry('Mia', 4, 1)],
      'jumps',
    );

    expect(sorted.map((e) => e.characterName)).toEqual(['Mia', 'Adam', 'Zoe']);
  });

  it('leaves the input array alone', () => {
    const entries = [entry('Far', 12, 1), entry('Here', 0, 40)];

    sortNearest(entries, 'jumps');

    expect(entries.map((e) => e.characterName)).toEqual(['Far', 'Here']);
  });
});

describe('cloneJumpOnCooldown', () => {
  it('is false when the character has never clone-jumped', () => {
    expect(cloneJumpOnCooldown(null)).toBe(false);
  });

  it('is false once the cooldown has passed', () => {
    expect(cloneJumpOnCooldown('2026-08-18T00:00:00Z', Date.parse('2026-08-18T01:00:00Z'))).toBe(
      false,
    );
  });

  it('is true while the cooldown still has time on it', () => {
    expect(cloneJumpOnCooldown('2026-08-18T06:00:00Z', Date.parse('2026-08-18T01:00:00Z'))).toBe(
      true,
    );
  });

  it('reads an unparseable timestamp as ready rather than blocking on it', () => {
    expect(cloneJumpOnCooldown('not a date')).toBe(false);
  });
});

describe('cloneLabel', () => {
  it('prefers the name the player gave the clone', () => {
    expect(cloneLabel(clone(1, 0, 0, { name: 'Cyno perch', locationName: 'Some Keepstar' }))).toBe(
      'Cyno perch',
    );
  });

  it('falls back to where the clone is', () => {
    expect(cloneLabel(clone(1, 0, 0, { locationName: 'Some Keepstar' }))).toBe('Some Keepstar');
  });

  it('falls back to the clone id when nothing else is known', () => {
    expect(cloneLabel(clone(42, 0, 0))).toBe('Clone 42');
  });
});

describe('formatJumps', () => {
  it('shows the count, zero included', () => {
    expect(formatJumps(0)).toBe('0');
    expect(formatJumps(17)).toBe('17');
  });

  it('shows a dash when no gate route exists', () => {
    expect(formatJumps(null)).toBe('—');
  });
});

describe('formatLightYears', () => {
  it('keeps two decimals inside jump-range distances', () => {
    expect(formatLightYears(4.978)).toBe('4.98 ly');
  });

  it('drops to one decimal once range is irrelevant', () => {
    expect(formatLightYears(42.31)).toBe('42.3 ly');
  });

  it('shows a dash when a position is unknown', () => {
    expect(formatLightYears(null)).toBe('—');
  });
});
