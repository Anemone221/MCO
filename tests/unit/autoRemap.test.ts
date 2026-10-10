import { describe, expect, it } from 'vitest';
import type {
  NeuralAttributes,
  PlanDraftEntry,
  PlanSkillInfo,
  TrainingAttribute,
} from '@shared/types';
import { BALANCED_ATTRIBUTES } from '@shared/training';
import { spForLevel } from '@main/fits/analyze';
import { autoRemap } from '@renderer/lib/autoRemap';
import {
  addRequirements,
  draftIssues,
  draftTotals,
  entryKey,
  mergeSkills,
  remapCount,
  setRemap,
  type SkillMap,
} from '@renderer/lib/planDraft';

function skill(
  skillTypeId: number,
  rank: number,
  attributes: [TrainingAttribute, TrainingAttribute],
  prereqs: Array<{ skillTypeId: number; level: number }> = [],
): PlanSkillInfo {
  return {
    skillTypeId,
    name: `Skill ${skillTypeId}`,
    groupId: 1,
    groupName: 'Test',
    rank,
    primaryAttribute: attributes[0],
    secondaryAttribute: attributes[1],
    spAtLevel: [1, 2, 3, 4, 5].map((level) => spForLevel(rank, level)),
    description: null,
    prereqs,
    published: true,
  };
}

const PW: [TrainingAttribute, TrainingAttribute] = ['perception', 'willpower'];
const IM: [TrainingAttribute, TrainingAttribute] = ['intelligence', 'memory'];

// Two Per/Wil skills, two Int/Mem skills, and a chain that crosses between the
// pairs: C (Int/Mem) needs A1 II, D (Per/Wil) needs C I.
const A1 = 1;
const A2 = 2;
const B1 = 11;
const B2 = 12;
const C = 21;
const D = 22;

const SKILLS: SkillMap = mergeSkills(new Map(), [
  skill(A1, 2, PW),
  skill(A2, 3, PW),
  skill(B1, 2, IM),
  skill(B2, 3, IM),
  skill(C, 4, IM, [{ skillTypeId: A1, level: 2 }]),
  skill(D, 4, PW, [{ skillTypeId: C, level: 1 }]),
]);

const PER_WIL: NeuralAttributes = {
  charisma: 17,
  intelligence: 17,
  memory: 17,
  perception: 27,
  willpower: 21,
};

function pairOf(entry: PlanDraftEntry): string {
  const info = SKILLS.get(entry.skillTypeId!)!;
  return `${info.primaryAttribute}/${info.secondaryAttribute}`;
}

/** A1, B1, A2, B2 to V each — the pairs alternate skill by skill. */
function interleaved(): PlanDraftEntry[] {
  return addRequirements(
    [],
    [A1, B1, A2, B2].map((skillTypeId) => ({ skillTypeId, level: 5 })),
    SKILLS,
  );
}

describe('autoRemap', () => {
  it('groups each pair under the attributes that suit it and remaps between them', () => {
    const entries = interleaved();
    const result = autoRemap(entries, SKILLS, PER_WIL, 1)!;

    expect(result.points).toHaveLength(1);
    const [point] = result.points;
    expect(point!.attributes.intelligence).toBe(27);
    expect(point!.attributes.memory).toBe(21);
    expect(point!.previous).toEqual(PER_WIL);
    expect(point!.savedMinutes).toBeGreaterThan(0);

    // Per/Wil trains first at the starting attributes, Int/Mem after the remap.
    const pairs = result.entries.map(pairOf);
    expect(pairs.slice(0, point!.index).every((p) => p === 'perception/willpower')).toBe(true);
    expect(pairs.slice(point!.index).every((p) => p === 'intelligence/memory')).toBe(true);
    expect(result.entries[point!.index]!.remapBefore).toEqual(point!.attributes);

    expect(result.afterMinutes).toBeLessThan(result.beforeMinutes);
    expect(result.afterMinutes).toBeCloseTo(draftTotals(result.entries, SKILLS, PER_WIL).minutes);
    expect(result.moved).toBeGreaterThan(0);
  });

  it('beats a remap placed by hand in the interleaved order', () => {
    const entries = interleaved();
    const half = setRemap(entries, entryKey(entries[10]!), {
      ...BALANCED_ATTRIBUTES,
      charisma: 17,
      intelligence: 27,
      memory: 21,
      perception: 17,
      willpower: 17,
    });

    const result = autoRemap(half, SKILLS, PER_WIL, 1)!;
    expect(result.afterMinutes).toBeLessThan(draftTotals(half, SKILLS, PER_WIL).minutes);
    // The hand-placed remap is replaced, not added to.
    expect(remapCount(result.entries)).toBe(1);
  });

  it('never trains anything before what it needs', () => {
    const entries = addRequirements(
      [],
      [
        { skillTypeId: D, level: 3 },
        { skillTypeId: B2, level: 4 },
        { skillTypeId: A2, level: 4 },
      ],
      SKILLS,
    );

    for (const remaps of [1, 2, 3]) {
      const result = autoRemap(entries, SKILLS, BALANCED_ATTRIBUTES, remaps)!;
      const issues = [...draftIssues(result.entries, SKILLS).values()];
      expect(issues.filter((issue) => issue.kind === 'order')).toEqual([]);
      // Same rows, only reordered.
      expect(result.entries.map(entryKey).sort()).toEqual(entries.map(entryKey).sort());
      expect(result.points.length).toBeLessThanOrEqual(remaps);
      expect(result.afterMinutes).toBeLessThanOrEqual(result.beforeMinutes + 1e-9);
    }
  });

  it('places nothing when the starting attributes already suit the whole plan', () => {
    const entries = addRequirements([], [{ skillTypeId: A2, level: 5 }], SKILLS);
    const result = autoRemap(entries, SKILLS, PER_WIL, 2)!;

    expect(result.points).toEqual([]);
    expect(result.afterMinutes).toBeCloseTo(result.beforeMinutes);
    expect(result.moved).toBe(0);
  });

  it('remaps at the very start when the starting attributes suit nothing', () => {
    const entries = addRequirements([], [{ skillTypeId: B2, level: 5 }], SKILLS);
    const result = autoRemap(entries, SKILLS, PER_WIL, 1)!;

    expect(result.points).toHaveLength(1);
    expect(result.points[0]!.index).toBe(0);
    expect(result.points[0]!.attributes.intelligence).toBe(27);
  });

  it('keeps the starting total, implants included', () => {
    const implanted: NeuralAttributes = {
      charisma: 22,
      intelligence: 22,
      memory: 22,
      perception: 32,
      willpower: 26,
    };
    const result = autoRemap(interleaved(), SKILLS, implanted, 1)!;
    const total = (a: NeuralAttributes): number =>
      a.charisma + a.intelligence + a.memory + a.perception + a.willpower;

    expect(total(result.points[0]!.attributes)).toBe(total(implanted));
    expect(result.points[0]!.attributes.intelligence).toBe(32);
  });

  it('has nothing to work with when no row can be priced', () => {
    expect(autoRemap([], SKILLS, PER_WIL, 1)).toBeNull();
    expect(
      autoRemap([{ skillTypeId: null, skillName: 'Mystery', level: 1 }], SKILLS, PER_WIL, 1),
    ).toBeNull();
  });
});
