import { describe, expect, it } from 'vitest';
import {
  findCriticalMatch,
  implantSetKey,
  parseImplantSetKey,
} from '@main/clones/criticalImplants';
import { observeDocking } from '@main/notifications/criticalUndock';

describe('implantSetKey', () => {
  it('is order- and duplicate-insensitive', () => {
    expect(implantSetKey([30, 10, 20, 10])).toBe('10,20,30');
    expect(implantSetKey([20, 30, 10])).toBe(implantSetKey([10, 20, 30]));
  });

  it('round-trips through parseImplantSetKey', () => {
    expect(parseImplantSetKey(implantSetKey([3, 1, 2]))).toEqual([1, 2, 3]);
    expect(parseImplantSetKey('')).toEqual([]);
  });
});

describe('findCriticalMatch', () => {
  it('matches the exact set', () => {
    expect(findCriticalMatch([2, 1], ['1,2'])).toBe('1,2');
  });

  it('matches a pod wearing more than the critical set', () => {
    expect(findCriticalMatch([1, 2, 3], ['1,2'])).toBe('1,2');
  });

  it('does not match a pod missing one of the set', () => {
    expect(findCriticalMatch([1, 3], ['1,2'])).toBeNull();
  });

  it('never matches an empty set', () => {
    expect(findCriticalMatch([], [''])).toBeNull();
    expect(findCriticalMatch([1], [''])).toBeNull();
  });

  it('prefers the most specific of several matching sets', () => {
    expect(findCriticalMatch([1, 2, 3], ['1', '1,2,3', '1,2'])).toBe('1,2,3');
  });
});

describe('observeDocking', () => {
  const t0 = '2026-09-26T10:00:00.000Z';
  const t1 = '2026-09-26T10:00:20.000Z';
  const t2 = '2026-09-26T10:00:40.000Z';

  it('has no exposure while docked', () => {
    expect(observeDocking(undefined, true, t0)).toEqual({ docked: true, exposureStart: null });
  });

  it('starts an exposure on undock', () => {
    const docked = observeDocking(undefined, true, t0);
    expect(observeDocking(docked, false, t1)).toEqual({ docked: false, exposureStart: t1 });
  });

  it('keeps the same exposure while still in space', () => {
    const out = observeDocking(observeDocking(undefined, true, t0), false, t1);
    expect(observeDocking(out, false, t2).exposureStart).toBe(t1);
  });

  it('starts a fresh exposure after docking and undocking again', () => {
    let s = observeDocking(undefined, false, t0);
    s = observeDocking(s, true, t1);
    s = observeDocking(s, false, t2);
    expect(s.exposureStart).toBe(t2);
  });

  it('treats a first observation in space as an exposure', () => {
    expect(observeDocking(undefined, false, t0).exposureStart).toBe(t0);
  });
});
