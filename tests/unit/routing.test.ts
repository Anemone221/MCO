import { describe, expect, it } from 'vitest';
import {
  buildAdjacency,
  jumpsFrom,
  lightYearsBetween,
  METRES_PER_LIGHT_YEAR,
  type SystemJump,
} from '@main/map/routing';

/**
 * A chain 1—2—3—4 with a spur 2—5, plus an isolated system 9 standing in for
 * wormhole space (no stargates at all).
 */
const CHAIN: SystemJump[] = [
  { fromSystemId: 1, toSystemId: 2 },
  { fromSystemId: 2, toSystemId: 1 },
  { fromSystemId: 2, toSystemId: 3 },
  { fromSystemId: 3, toSystemId: 2 },
  { fromSystemId: 3, toSystemId: 4 },
  { fromSystemId: 4, toSystemId: 3 },
  { fromSystemId: 2, toSystemId: 5 },
  { fromSystemId: 5, toSystemId: 2 },
];

describe('buildAdjacency', () => {
  it('collapses the SDE’s two rows per gate into one neighbour each way', () => {
    const adjacency = buildAdjacency(CHAIN);

    expect(adjacency.get(2)).toEqual([1, 3, 5]);
    expect(adjacency.get(1)).toEqual([2]);
  });

  it('adds the reverse of a one-sided link', () => {
    // Only the outbound row: the far side must still lead back.
    const adjacency = buildAdjacency([{ fromSystemId: 10, toSystemId: 11 }]);

    expect(adjacency.get(10)).toEqual([11]);
    expect(adjacency.get(11)).toEqual([10]);
  });

  it('ignores a gate that names its own system', () => {
    expect(buildAdjacency([{ fromSystemId: 7, toSystemId: 7 }]).size).toBe(0);
  });
});

describe('jumpsFrom', () => {
  it('measures the origin as zero jumps', () => {
    expect(jumpsFrom(buildAdjacency(CHAIN), 1).get(1)).toBe(0);
  });

  it('counts gates outward, shortest route first', () => {
    const distance = jumpsFrom(buildAdjacency(CHAIN), 1);

    expect(distance.get(2)).toBe(1);
    expect(distance.get(3)).toBe(2);
    expect(distance.get(4)).toBe(3);
    expect(distance.get(5)).toBe(2);
  });

  it('takes the shorter of two routes to the same system', () => {
    // 1—2—3—4 with a 1—4 shortcut: 4 is one jump, not three.
    const withShortcut = buildAdjacency([
      ...CHAIN,
      { fromSystemId: 1, toSystemId: 4 },
    ]);

    expect(jumpsFrom(withShortcut, 1).get(4)).toBe(1);
    expect(jumpsFrom(withShortcut, 1).get(3)).toBe(2);
  });

  it('omits systems with no gate route rather than calling them far away', () => {
    const distance = jumpsFrom(buildAdjacency(CHAIN), 1);

    // 9 has no stargates — the caller reports "no route", not a big number.
    expect(distance.has(9)).toBe(false);
  });

  it('returns just the origin when the graph is empty', () => {
    expect([...jumpsFrom(buildAdjacency([]), 30000142)]).toEqual([[30000142, 0]]);
  });
});

describe('lightYearsBetween', () => {
  it('converts metres to light years', () => {
    const origin = { x: 0, y: 0, z: 0 };
    const away = { x: 5 * METRES_PER_LIGHT_YEAR, y: 0, z: 0 };

    expect(lightYearsBetween(origin, away)).toBeCloseTo(5, 10);
  });

  it('measures diagonally across all three axes', () => {
    const a = { x: 0, y: 0, z: 0 };
    const b = {
      x: 3 * METRES_PER_LIGHT_YEAR,
      y: 4 * METRES_PER_LIGHT_YEAR,
      z: 0,
    };

    expect(lightYearsBetween(a, b)).toBeCloseTo(5, 10);
  });

  it('is zero for a system measured against itself', () => {
    const position = { x: -8.85e16, y: 4.23e16, z: -4.45e16 };

    expect(lightYearsBetween(position, position)).toBe(0);
  });
});
