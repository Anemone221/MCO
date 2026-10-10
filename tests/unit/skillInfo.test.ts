import { describe, expect, it } from 'vitest';
import type { PlanSkillInfo } from '@shared/types';
import { BALANCED_ATTRIBUTES } from '@shared/training';
import { spForLevel } from '@main/fits/analyze';
import { skillDependents, skillLevelRows } from '../../src/renderer/src/lib/skillInfo';

function skill(
  skillTypeId: number,
  name: string,
  extra: Partial<PlanSkillInfo> = {},
): PlanSkillInfo {
  const rank = extra.rank ?? 1;
  return {
    skillTypeId,
    name,
    groupId: 1,
    groupName: 'Test',
    rank,
    primaryAttribute: 'intelligence',
    secondaryAttribute: 'memory',
    spAtLevel: [1, 2, 3, 4, 5].map((level) => spForLevel(rank, level)),
    description: null,
    prereqs: [],
    published: true,
    ...extra,
  };
}

describe('skillLevelRows', () => {
  it('lists total SP per level and the time for each step alone', () => {
    const rows = skillLevelRows(skill(1, 'A', { rank: 2 }), BALANCED_ATTRIBUTES);
    expect(rows.map((r) => r.level)).toEqual([1, 2, 3, 4, 5]);
    const sp = [1, 2, 3, 4, 5].map((level) => spForLevel(2, level));
    expect(rows.map((r) => r.sp)).toEqual(sp);
    // Int 20 + Mem 20 / 2 = 30 SP/min.
    expect(rows[0]!.minutes).toBeCloseTo(sp[0]! / 30);
    expect(rows[4]!.minutes).toBeCloseTo((sp[4]! - sp[3]!) / 30);
  });

  it('has no time without attribute data', () => {
    const rows = skillLevelRows(
      skill(1, 'A', { primaryAttribute: null, secondaryAttribute: null }),
      BALANCED_ATTRIBUTES,
    );
    expect(rows.every((r) => r.minutes === null)).toBe(true);
    expect(rows[0]!.sp).toBe(spForLevel(1, 1));
  });
});

describe('skillDependents', () => {
  it('finds published skills that need this one, by level then name', () => {
    const catalog = [
      skill(1, 'Base'),
      skill(2, 'Zeta', { prereqs: [{ skillTypeId: 1, level: 3 }] }),
      skill(3, 'Alpha', { prereqs: [{ skillTypeId: 1, level: 3 }] }),
      skill(4, 'Early', { prereqs: [{ skillTypeId: 1, level: 1 }] }),
      skill(5, 'Retired', { prereqs: [{ skillTypeId: 1, level: 1 }], published: false }),
      skill(6, 'Unrelated', { prereqs: [{ skillTypeId: 2, level: 1 }] }),
    ];
    expect(skillDependents(catalog, 1).map((d) => [d.skill.name, d.level])).toEqual([
      ['Early', 1],
      ['Alpha', 3],
      ['Zeta', 3],
    ]);
  });
});
