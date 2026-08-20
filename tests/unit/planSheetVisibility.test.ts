import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SdeStatus, SkillPlan } from '@shared/types';

/**
 * Which skill plans reach a character sheet. The repositories are stubbed so
 * the question under test is only the filter — with a note on the count of
 * analyses run, because a hidden plan must cost nothing, not just render
 * nothing (each listed plan is a full prerequisite expansion, on 90+ sheets).
 */

let stored: SkillPlan[] = [];
let hasSkillData = true;
/** Skill type ids the analysis was asked to rank, one entry per plan analysed. */
let ranked: number[][] = [];

function plan(id: number, name: string, showOnCharacterSheet: boolean): SkillPlan {
  return {
    id,
    name,
    // One skill per plan, so an analysed plan is identifiable by its rank call.
    planText: `Skill ${id} V`,
    importedAt: '2026-01-01T00:00:00Z',
    showOnCharacterSheet,
  };
}

vi.mock('@main/db/repositories/plans', () => ({
  listPlans: () => stored,
  getPlan: (id: number) => stored.find((p) => p.id === id) ?? null,
  createPlan: () => stored[0]!,
  updatePlan: () => stored[0]!,
  setPlanSheetVisibility: () => stored[0]!,
}));

vi.mock('@main/db/repositories/sde', () => ({
  getSdeStatus: (): SdeStatus => ({
    installed: true,
    version: '3351823',
    importedAt: '2026-01-01T00:00:00Z',
    hasSkillData,
    hasMapData: true,
    hasSkillAttributes: true,
    hasBlueprintData: true,
    hasJumpData: true,
  }),
  // "Skill <id>" resolves to type id <id>: a plan's own id identifies its skill.
  resolveTypeIdsByName: (names: string[]) => {
    const resolved = new Map<string, number>();
    for (const name of names) resolved.set(name, Number(name.replace('Skill ', '')));
    return { resolved, unresolved: [] };
  },
  getSkillReqsForTypes: () => [],
  getSkillRanks: (ids: number[]) => {
    ranked.push([...ids]);
    return new Map(ids.map((id) => [id, 1]));
  },
  getTypeNames: (ids: number[]) => new Map(ids.map((id) => [id, `Skill ${id}`])),
}));

vi.mock('@main/db/repositories/characters', () => ({ listCharacters: () => [] }));
vi.mock('@main/db/repositories/skills', () => ({ getCharacterSkillMap: () => new Map() }));
vi.mock('@main/services/trainingData', () => ({
  getNeuralAttributes: () => undefined,
  getSkillTrainingAttributes: () => new Map(),
}));

const { listPlanProgressForCharacter } = await import('@main/services/planService');

beforeEach(() => {
  hasSkillData = true;
  ranked = [];
});

describe('listPlanProgressForCharacter', () => {
  it('lists the plans opted in to character sheets', () => {
    stored = [plan(1, 'Shown', true), plan(2, 'Hidden', false), plan(3, 'Also shown', true)];

    const { plans } = listPlanProgressForCharacter(93);

    expect(plans.map((p) => p.planName)).toEqual(['Shown', 'Also shown']);
  });

  it('does not analyse a hidden plan at all', () => {
    stored = [plan(1, 'Shown', true), plan(2, 'Hidden', false)];

    listPlanProgressForCharacter(93);

    // One analysis, for plan 1's skill; plan 2's never gets expanded.
    expect(ranked).toEqual([[1]]);
  });

  it('reads as "no plans" when every plan is hidden, not as missing SDE data', () => {
    stored = [plan(1, 'Hidden', false)];

    // needsSkillData is what makes the sheet say "re-import static data"; an
    // empty sheet because the user hid everything must not blame the SDE.
    expect(listPlanProgressForCharacter(93)).toEqual({ needsSkillData: false, plans: [] });
  });

  it('still reports missing skill data when a visible plan cannot be analysed', () => {
    stored = [plan(1, 'Shown', true), plan(2, 'Hidden', false)];
    hasSkillData = false;

    expect(listPlanProgressForCharacter(93)).toEqual({ needsSkillData: true, plans: [] });
  });
});
