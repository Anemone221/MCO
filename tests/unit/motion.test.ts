import { describe, expect, it } from 'vitest';
import { easeOutCubic, interpolateCount } from '@renderer/lib/motion';

describe('easeOutCubic', () => {
  it('starts at 0 and ends at 1', () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
  });

  it('clamps out-of-range progress', () => {
    expect(easeOutCubic(-0.5)).toBe(0);
    expect(easeOutCubic(1.5)).toBe(1);
  });

  it('is monotonically increasing', () => {
    let previous = -1;
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const value = easeOutCubic(t);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });

  it('front-loads its progress (ease-out)', () => {
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);
  });
});

describe('interpolateCount', () => {
  it('hits both endpoints exactly', () => {
    expect(interpolateCount(10, 90, 0)).toBe(10);
    expect(interpolateCount(10, 90, 1)).toBe(90);
  });

  it('interpolates downward as well as upward', () => {
    const mid = interpolateCount(100, 0, 0.5);
    expect(mid).toBeLessThan(100);
    expect(mid).toBeGreaterThan(0);
  });

  it('is constant when from equals to', () => {
    expect(interpolateCount(42, 42, 0.3)).toBe(42);
  });
});
