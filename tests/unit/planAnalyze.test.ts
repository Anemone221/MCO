import { describe, expect, it } from 'vitest';
import { analyzePlan } from '@main/plans/analyze';
import { spForLevel, type AnalysisCharacter, type SkillRequirement } from '@main/fits/analyze';

function character(
  id: number,
  name: string,
  skills: Record<number, { sp: number; trainedLevel: number }>,
): AnalysisCharacter {
  return {
    characterId: id,
    characterName: name,
    skills: new Map(Object.entries(skills).map(([k, v]) => [Number(k), v])),
  };
}

describe('analyzePlan', () => {
  const base = {
    directReqs: [{ skillTypeId: 100, level: 3 }] as SkillRequirement[],
    skillPrereqs: new Map<number, SkillRequirement[]>(),
    ranks: new Map<number, number>([[100, 1]]),
    skillNames: new Map<number, string>([[100, 'Some Skill']]),
  };

  it('marks a character who meets every listed skill as complete', () => {
    const [result] = analyzePlan({
      ...base,
      characters: [character(1, 'Able', { 100: { sp: 8000, trainedLevel: 3 } })],
    });
    expect(result!.complete).toBe(true);
    expect(result!.spGap).toBe(0);
  });

  it('computes the SP gap for a partially trained character', () => {
    const [result] = analyzePlan({
      ...base,
      characters: [character(2, 'Partial', { 100: { sp: 250, trainedLevel: 1 } })],
    });
    expect(result!.complete).toBe(false);
    expect(result!.spGap).toBe(8000 - 250);
    expect(result!.missingSkills[0]).toMatchObject({ haveLevel: 1, needLevel: 3 });
  });

  it('counts an untrained transitive prerequisite toward the SP gap', () => {
    const [result] = analyzePlan({
      directReqs: [{ skillTypeId: 100, level: 3 }],
      skillPrereqs: new Map([[100, [{ skillTypeId: 200, level: 2 }]]]),
      ranks: new Map([
        [100, 1],
        [200, 1],
      ]),
      skillNames: new Map(),
      characters: [character(3, 'Fresh', {})],
    });
    expect(result!.complete).toBe(false);
    expect(result!.spGap).toBe(spForLevel(1, 3) + spForLevel(1, 2));
  });

  it('passes the injector and time gaps through to plan results', () => {
    const [result] = analyzePlan({
      ...base,
      skillAttributes: new Map([[100, { primary: 'intelligence', secondary: 'memory' }]]),
      characters: [
        {
          ...character(2, 'Partial', { 100: { sp: 250, trainedLevel: 1 } }),
          attributes: { charisma: 17, intelligence: 17, memory: 17, perception: 17, willpower: 17 },
        },
      ],
    });
    expect(result!.lsiGap).toBe(1);
    expect(result!.timeGapMinutes).toBeCloseTo(7750 / 25.5, 5);
  });
});
