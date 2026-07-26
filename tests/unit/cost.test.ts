import { describe, expect, it } from 'vitest';
import {
  injectorYield,
  injectorsForGap,
  spPerMinute,
  trainingAttributesFromIds,
  trainingTimeMinutes,
  type NeuralAttributes,
  type SkillTrainingAttributes,
} from '@main/fits/cost';

const attrs = (overrides: Partial<NeuralAttributes> = {}): NeuralAttributes => ({
  charisma: 17,
  intelligence: 17,
  memory: 17,
  perception: 17,
  willpower: 17,
  ...overrides,
});

describe('injectorYield', () => {
  it('follows the diminishing-returns tiers with boundaries on the lower yield', () => {
    expect(injectorYield(0)).toBe(500_000);
    expect(injectorYield(4_999_999)).toBe(500_000);
    expect(injectorYield(5_000_000)).toBe(400_000);
    expect(injectorYield(49_999_999)).toBe(400_000);
    expect(injectorYield(50_000_000)).toBe(300_000);
    expect(injectorYield(79_999_999)).toBe(300_000);
    expect(injectorYield(80_000_000)).toBe(150_000);
    expect(injectorYield(200_000_000)).toBe(150_000);
  });
});

describe('injectorsForGap', () => {
  it('is zero for a closed or negative gap', () => {
    expect(injectorsForGap(10_000_000, 0)).toBe(0);
    expect(injectorsForGap(10_000_000, -500)).toBe(0);
  });

  it('rounds up to whole injectors', () => {
    expect(injectorsForGap(10_000_000, 400_000)).toBe(1);
    expect(injectorsForGap(10_000_000, 400_001)).toBe(2);
  });

  it('crosses a tier boundary mid-simulation', () => {
    // 4.8m -> 500k (5.3m), then two 400k injectors for the remaining 500k.
    expect(injectorsForGap(4_800_000, 1_000_000)).toBe(3);
  });

  it('lands exactly on a tier edge before the yield drops', () => {
    expect(injectorsForGap(4_500_000, 500_000)).toBe(1);
    // The second injector fires at exactly 5m, so it only grants 400k.
    expect(injectorsForGap(4_500_000, 900_000)).toBe(2);
  });

  it('uses the 150k tier at 80m or more', () => {
    expect(injectorsForGap(80_000_000, 300_000)).toBe(2);
    expect(injectorsForGap(80_000_000, 300_001)).toBe(3);
  });
});

describe('spPerMinute', () => {
  it('is primary plus half the secondary attribute', () => {
    const skill: SkillTrainingAttributes = { primary: 'perception', secondary: 'willpower' };
    expect(spPerMinute(attrs({ perception: 17, willpower: 17 }), skill)).toBe(25.5);
    expect(spPerMinute(attrs({ perception: 27, willpower: 21 }), skill)).toBe(37.5);
  });
});

describe('trainingAttributesFromIds', () => {
  it('maps dogma attribute ids to named attributes', () => {
    expect(trainingAttributesFromIds(167, 168)).toEqual({
      primary: 'perception',
      secondary: 'willpower',
    });
    expect(trainingAttributesFromIds(164, 165)).toEqual({
      primary: 'charisma',
      secondary: 'intelligence',
    });
  });

  it('is null when either id is unknown', () => {
    expect(trainingAttributesFromIds(0, 168)).toBeNull();
    expect(trainingAttributesFromIds(999, 164)).toBeNull();
  });
});

describe('trainingTimeMinutes', () => {
  const perWil = new Map<number, SkillTrainingAttributes>([
    [100, { primary: 'perception', secondary: 'willpower' }],
    [200, { primary: 'intelligence', secondary: 'memory' }],
  ]);

  it('is zero for an empty list even without attribute data', () => {
    expect(trainingTimeMinutes([], perWil, null)).toBe(0);
    expect(trainingTimeMinutes([], new Map(), attrs())).toBe(0);
  });

  it('is null when the character has no synced attributes', () => {
    expect(trainingTimeMinutes([{ skillTypeId: 100, spDelta: 1000 }], perWil, null)).toBeNull();
  });

  it('is null when any missing skill lacks training-attribute data', () => {
    const missing = [
      { skillTypeId: 100, spDelta: 1000 },
      { skillTypeId: 999, spDelta: 1000 },
    ];
    expect(trainingTimeMinutes(missing, perWil, attrs())).toBeNull();
  });

  it('is null when the training rate is not positive', () => {
    const zeroed = attrs({ perception: 0, willpower: 0 });
    expect(trainingTimeMinutes([{ skillTypeId: 100, spDelta: 1000 }], perWil, zeroed)).toBeNull();
  });

  it('sums per-skill time at each skill’s own rate', () => {
    // 2550 SP at 25.5 SP/min = 100 minutes.
    expect(trainingTimeMinutes([{ skillTypeId: 100, spDelta: 2550 }], perWil, attrs())).toBe(100);
    // Second skill trains at int/mem: 27 + 21/2 = 37.5 SP/min, 3750 SP = 100 min.
    const boosted = attrs({ intelligence: 27, memory: 21 });
    const missing = [
      { skillTypeId: 100, spDelta: 2550 },
      { skillTypeId: 200, spDelta: 3750 },
    ];
    expect(trainingTimeMinutes(missing, perWil, boosted)).toBe(200);
  });
});
