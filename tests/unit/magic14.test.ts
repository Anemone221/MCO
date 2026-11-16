import { describe, expect, it } from 'vitest';
import type { PlanSkillInfo } from '@shared/types';
import { addRequirements, MAGIC_14, magic14Requirements, mergeSkills } from '@renderer/lib/planDraft';

function skill(skillTypeId: number, name: string, prereqs: PlanSkillInfo['prereqs'] = []): PlanSkillInfo {
  return {
    skillTypeId,
    name,
    groupId: 1,
    groupName: 'Core',
    rank: 1,
    primaryAttribute: 'intelligence',
    secondaryAttribute: 'memory',
    spAtLevel: [250, 1415, 8000, 45255, 256000],
    description: null,
    prereqs,
    published: true,
  };
}

describe('magic14Requirements', () => {
  it('resolves every Magic 14 skill by name to the chosen level', () => {
    const skills = mergeSkills(
      new Map(),
      MAGIC_14.map((name, i) => skill(1000 + i, name)),
    );
    const { requirements, missing } = magic14Requirements(skills, 4);
    expect(missing).toEqual([]);
    expect(requirements).toHaveLength(14);
    expect(requirements.every((r) => r.level === 4)).toBe(true);
    // One row per level: 14 skills × 4 levels.
    expect(addRequirements([], requirements, skills)).toHaveLength(56);
  });

  it('reports names the catalogue does not know', () => {
    const skills = mergeSkills(new Map(), [skill(1, 'cpu management'), skill(2, 'Mechanics')]);
    const { requirements, missing } = magic14Requirements(skills, 1);
    expect(requirements.map((r) => r.skillTypeId).sort()).toEqual([1, 2]);
    expect(missing).toHaveLength(12);
    expect(missing).not.toContain('CPU Management');
  });

  it('pulls prerequisites in ahead of the skill that needs them', () => {
    const skills = mergeSkills(new Map(), [
      skill(1, 'Shield Management'),
      skill(2, 'Shield Operation', [{ skillTypeId: 1, level: 1 }]),
    ]);
    const added = addRequirements([], magic14Requirements(skills, 1).requirements, skills);
    expect(added.map((e) => e.skillName)).toEqual(['Shield Management', 'Shield Operation']);
  });
});
