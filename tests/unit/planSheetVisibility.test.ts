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

function plan(
  id: number,
  name: string,
  showOnCharacterSheet: boolean,
  showOnRoster = false,
): SkillPlan {
  return {
    id,
    name,
    // One skill per plan, so an analysed plan is identifiable by its rank call.
    planText: `Skill ${id} V`,
    importedAt: '2026-01-01T00:00:00Z',
    showOnCharacterSheet,
    showOnRoster,
  };
}

vi.mock('@main/db/repositories/plans', () => ({
  listPlans: () => stored,
  getPlan: (id: number) => stored.find((p) => p.id === id) ?? null,
  createPlan: () => stored[0]!,
  updatePlan: () => stored[0]!,
  setPlanSheetVisibility: () => stored[0]!,
  setPlanRosterVisibility: () => stored[0]!,
}));

vi.mock('@main/db/repositories/sde', () => ({
  getSdeStatus: (): SdeStatus => ({
    installed: true,
    version: '3351823',
    importedAt: '2026-01-01T00:00:00Z',
    hasSkillData,
    hasMapData: true,
    hasSkillAttributes: true,
    hasSkillDescriptions: true,
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

/** Character ids on the roster, for the roster-wide analysis. */
let rosterIds: number[] = [];

vi.mock('@main/db/repositories/characters', () => ({
  listCharacters: () => rosterIds.map((id) => ({ id, name: `Pilot ${id}` })),
}));
vi.mock('@main/services/trainingData', () => ({
  getEffectiveSkillMap: () => new Map(),
  getNeuralAttributes: () => undefined,
  getSkillTrainingAttributes: () => new Map(),
}));

const { listPlanProgressForCharacter, listRosterPlanProgress } = await import(
  '@main/services/planService'
);

beforeEach(() => {
  hasSkillData = true;
  ranked = [];
  rosterIds = [];
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

describe('listRosterPlanProgress', () => {
  it('gives each roster-flagged plan a status for every character', () => {
    stored = [plan(1, 'Column', true, true), plan(2, 'Sheet only', true, false)];
    rosterIds = [90, 91];

    const { needsSkillData, plans } = listRosterPlanProgress();

    expect(needsSkillData).toBe(false);
    expect(plans.map((p) => p.planName)).toEqual(['Column']);
    expect(Object.keys(plans[0]!.statuses).map(Number).sort()).toEqual([90, 91]);
    // The skill-less stubs hold nothing, so nobody has started the plan.
    expect(plans[0]!.statuses[90]!.complete).toBe(false);
  });

  it('does not analyse a plan left off the roster', () => {
    stored = [plan(1, 'Column', false, true), plan(2, 'Sheet only', true, false)];
    rosterIds = [90];

    listRosterPlanProgress();

    expect(ranked).toEqual([[1]]);
  });

  it('reads as "no columns" when no plan is flagged, not as missing SDE data', () => {
    stored = [plan(1, 'Sheet only', true, false)];
    hasSkillData = false;

    expect(listRosterPlanProgress()).toEqual({ needsSkillData: false, plans: [] });
  });

  it('reports missing skill data when a flagged plan cannot be analysed', () => {
    stored = [plan(1, 'Column', true, true)];
    hasSkillData = false;

    expect(listRosterPlanProgress()).toEqual({ needsSkillData: true, plans: [] });
  });
});
