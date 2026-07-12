import { describe, expect, it } from 'vitest';
import {
  analyzeFit,
  buildSkillPrereqMap,
  expandClosure,
  spForLevel,
  type AnalysisCharacter,
  type PrereqRow,
  type SkillRequirement,
} from '@main/fits/analyze';

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

describe('spForLevel', () => {
  it('matches the canonical EVE skill-point thresholds', () => {
    expect(spForLevel(1, 0)).toBe(0);
    expect(spForLevel(1, 1)).toBe(250);
    expect(spForLevel(1, 3)).toBe(8000);
    expect(spForLevel(1, 5)).toBe(256_000);
    expect(spForLevel(5, 5)).toBe(1_280_000);
  });
});

describe('expandClosure', () => {
  it('pulls in transitive skill prerequisites', () => {
    const direct = new Map<number, number>([[10, 3]]);
    const prereqs = new Map<number, SkillRequirement[]>([
      [10, [{ skillTypeId: 20, level: 2 }]],
      [20, [{ skillTypeId: 30, level: 1 }]],
    ]);
    expect(expandClosure(direct, prereqs)).toEqual(
      new Map([
        [10, 3],
        [20, 2],
        [30, 1],
      ]),
    );
  });
});

describe('buildSkillPrereqMap', () => {
  it('walks a multi-level transitive prerequisite chain', () => {
    const db = new Map<number, PrereqRow[]>([
      [10, [{ typeId: 10, skillTypeId: 20, level: 2 }]],
      [20, [{ typeId: 20, skillTypeId: 30, level: 1 }]],
    ]);
    const fetchReqs = (typeIds: number[]): PrereqRow[] =>
      typeIds.flatMap((id) => db.get(id) ?? []);

    const { skillPrereqs, allSkillIds } = buildSkillPrereqMap([10], fetchReqs);
    expect(skillPrereqs.get(10)).toEqual([{ skillTypeId: 20, level: 2 }]);
    expect(skillPrereqs.get(20)).toEqual([{ skillTypeId: 30, level: 1 }]);
    expect(allSkillIds.sort()).toEqual([10, 20, 30]);
  });

  it('dedupes a prerequisite reached via two separate seeds', () => {
    const db = new Map<number, PrereqRow[]>([
      [10, [{ typeId: 10, skillTypeId: 30, level: 1 }]],
      [20, [{ typeId: 20, skillTypeId: 30, level: 1 }]],
    ]);
    const fetchReqs = (typeIds: number[]): PrereqRow[] =>
      typeIds.flatMap((id) => db.get(id) ?? []);

    const { allSkillIds } = buildSkillPrereqMap([10, 20], fetchReqs);
    expect(allSkillIds.sort()).toEqual([10, 20, 30]);
  });
});

describe('analyzeFit', () => {
  const base = {
    directReqs: [{ skillTypeId: 100, level: 3 }] as SkillRequirement[],
    skillPrereqs: new Map<number, SkillRequirement[]>(),
    ranks: new Map<number, number>([[100, 1]]),
    skillNames: new Map<number, string>([[100, 'Some Skill']]),
  };

  it('marks a character who meets every requirement as able to fly', () => {
    const [result] = analyzeFit({
      ...base,
      characters: [character(1, 'Able', { 100: { sp: 8000, trainedLevel: 3 } })],
    });
    expect(result!.canFly).toBe(true);
    expect(result!.spGap).toBe(0);
  });

  it('computes the SP gap for a partially trained character', () => {
    const [result] = analyzeFit({
      ...base,
      characters: [character(2, 'Partial', { 100: { sp: 250, trainedLevel: 1 } })],
    });
    expect(result!.canFly).toBe(false);
    expect(result!.spGap).toBe(8000 - 250);
    expect(result!.missingSkills[0]).toMatchObject({ haveLevel: 1, needLevel: 3 });
  });

  it('counts untrained prerequisite skills toward the SP gap', () => {
    const [result] = analyzeFit({
      directReqs: [{ skillTypeId: 100, level: 3 }],
      skillPrereqs: new Map([[100, [{ skillTypeId: 200, level: 2 }]]]),
      ranks: new Map([
        [100, 1],
        [200, 1],
      ]),
      skillNames: new Map(),
      characters: [character(3, 'Fresh', {})],
    });
    expect(result!.canFly).toBe(false);
    expect(result!.spGap).toBe(spForLevel(1, 3) + spForLevel(1, 2));
  });
});
