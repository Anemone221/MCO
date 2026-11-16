import { describe, expect, it } from 'vitest';
import type { PlanDraftEntry, PlanSkillInfo } from '@shared/types';
import { draftText, mergeSkills } from '@renderer/lib/planDraft';
import { diffPlans, planDelta, requiredLevels } from '@renderer/lib/planDiff';

const SP = [250, 1415, 8000, 45255, 256000];

function skill(
  skillTypeId: number,
  name: string,
  prereqs: PlanSkillInfo['prereqs'] = [],
  groupName = 'Spaceship Command',
): PlanSkillInfo {
  return {
    skillTypeId,
    name,
    groupId: 1,
    groupName,
    rank: 1,
    primaryAttribute: 'perception',
    secondaryAttribute: 'willpower',
    spAtLevel: SP,
    description: null,
    prereqs,
    published: true,
  };
}

// Frigate ← Destroyer ← Cruiser (Cruiser needs Destroyer III, Destroyer needs Frigate IV).
const FRIGATE = 1;
const DESTROYER = 2;
const CRUISER = 3;
const GUNNERY = 4;
const skills = mergeSkills(new Map(), [
  skill(FRIGATE, 'Caldari Frigate'),
  skill(DESTROYER, 'Caldari Destroyer', [{ skillTypeId: FRIGATE, level: 4 }]),
  skill(CRUISER, 'Caldari Cruiser', [{ skillTypeId: DESTROYER, level: 3 }]),
  skill(GUNNERY, 'Gunnery', [], 'Gunnery'),
]);

function e(skillTypeId: number | null, skillName: string, level: number): PlanDraftEntry {
  return { skillTypeId, skillName, level };
}

describe('requiredLevels', () => {
  it('keeps the highest level a plan writes, whatever the row order', () => {
    const needs = requiredLevels(
      [e(GUNNERY, 'Gunnery', 5), e(GUNNERY, 'Gunnery', 2)],
      skills,
      false,
    );
    expect(needs.get(String(GUNNERY))).toMatchObject({ level: 5, written: 5 });
  });

  it('counts prerequisites only when asked, and marks them as not written', () => {
    const plan = [e(CRUISER, 'Caldari Cruiser', 1)];
    expect([...requiredLevels(plan, skills, false).keys()]).toEqual([String(CRUISER)]);

    const withPrereqs = requiredLevels(plan, skills, true);
    expect(withPrereqs.get(String(DESTROYER))).toMatchObject({ level: 3, written: 0 });
    expect(withPrereqs.get(String(FRIGATE))).toMatchObject({ level: 4, written: 0 });
  });

  it('lets a written level beat the level a prerequisite implies', () => {
    const needs = requiredLevels(
      [e(CRUISER, 'Caldari Cruiser', 1), e(FRIGATE, 'Caldari Frigate', 5)],
      skills,
      true,
    );
    expect(needs.get(String(FRIGATE))).toMatchObject({ level: 5, written: 5 });
  });

  it('survives a prerequisite cycle from a bad import', () => {
    const looped = mergeSkills(new Map(), [
      skill(10, 'A', [{ skillTypeId: 11, level: 1 }]),
      skill(11, 'B', [{ skillTypeId: 10, level: 1 }]),
    ]);
    expect(requiredLevels([e(10, 'A', 1)], looped, true).size).toBe(2);
  });
});

describe('diffPlans', () => {
  it('classifies every skill and orders A-side differences first', () => {
    const a = [e(GUNNERY, 'Gunnery', 5), e(FRIGATE, 'Caldari Frigate', 3)];
    const b = [e(FRIGATE, 'Caldari Frigate', 3), e(DESTROYER, 'Caldari Destroyer', 1)];
    const { rows, summary } = diffPlans(a, b, skills, { includePrereqs: false });

    expect(rows.map((r) => [r.name, r.status])).toEqual([
      ['Gunnery', 'only-a'],
      ['Caldari Destroyer', 'only-b'],
      ['Caldari Frigate', 'same'],
    ]);
    expect(summary).toMatchObject({ onlyA: 1, onlyB: 1, same: 1, aHigher: 0, bHigher: 0 });
  });

  it('prices each side and what each needs beyond the other', () => {
    const a = [e(GUNNERY, 'Gunnery', 5), e(FRIGATE, 'Caldari Frigate', 2)];
    const b = [e(GUNNERY, 'Gunnery', 3), e(FRIGATE, 'Caldari Frigate', 4)];
    const { rows, summary } = diffPlans(a, b, skills, { includePrereqs: false });

    expect(rows.find((r) => r.skillTypeId === GUNNERY)).toMatchObject({
      status: 'a-higher',
      spA: 256000,
      spB: 8000,
    });
    expect(rows.find((r) => r.skillTypeId === FRIGATE)?.status).toBe('b-higher');
    expect(summary.totalSpA).toBe(256000 + 1415);
    expect(summary.totalSpB).toBe(8000 + 45255);
    expect(summary.spABeyondB).toBe(256000 - 8000);
    expect(summary.spBBeyondA).toBe(45255 - 1415);
  });

  it('finds the difference a prerequisite hides', () => {
    // A writes Frigate III; B only writes Cruiser, which needs Frigate IV.
    const a = [e(FRIGATE, 'Caldari Frigate', 3)];
    const b = [e(CRUISER, 'Caldari Cruiser', 1)];

    const written = diffPlans(a, b, skills, { includePrereqs: false });
    expect(written.rows.find((r) => r.skillTypeId === FRIGATE)?.status).toBe('only-a');

    const trained = diffPlans(a, b, skills, { includePrereqs: true });
    expect(trained.rows.find((r) => r.skillTypeId === FRIGATE)).toMatchObject({
      status: 'b-higher',
      levelA: 3,
      levelB: 4,
      writtenB: 0,
    });
  });

  it('compares skills the SDE does not know by name, without costing them', () => {
    const a = [e(null, 'Retired Skill', 2)];
    const b = [e(null, 'retired skill', 4)];
    const { rows, summary } = diffPlans(a, b, skills, { includePrereqs: true });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'b-higher', spA: null, spB: null });
    expect(summary.uncosted).toBe(1);
    expect(summary.totalSpA).toBe(0);
  });

  it('reports identical plans as all the same', () => {
    const plan = [e(CRUISER, 'Caldari Cruiser', 2)];
    const { summary } = diffPlans(plan, plan, skills, { includePrereqs: true });
    expect(summary).toMatchObject({ same: 3, onlyA: 0, onlyB: 0, spBBeyondA: 0, spABeyondB: 0 });
  });
});

describe('planDelta', () => {
  it('queues what the target adds, prerequisites first and nothing already trained', () => {
    const from = [e(FRIGATE, 'Caldari Frigate', 2)];
    const to = [e(CRUISER, 'Caldari Cruiser', 1)];
    expect(draftText(planDelta(from, to, skills))).toBe(
      [
        'Caldari Frigate III',
        'Caldari Frigate IV',
        'Caldari Destroyer I',
        'Caldari Destroyer II',
        'Caldari Destroyer III',
        'Caldari Cruiser I',
      ].join('\n'),
    );
  });

  it('is empty when the source already covers the target', () => {
    const from = [e(CRUISER, 'Caldari Cruiser', 3)];
    const to = [e(FRIGATE, 'Caldari Frigate', 4)];
    expect(planDelta(from, to, skills)).toEqual([]);
  });

  it('carries unknown skills over once, at the end', () => {
    const to = [e(null, 'Mystery', 1), e(GUNNERY, 'Gunnery', 1), e(null, 'Mystery', 1)];
    expect(planDelta([], to, skills).map((x) => x.skillName)).toEqual(['Gunnery', 'Mystery']);
  });
});
