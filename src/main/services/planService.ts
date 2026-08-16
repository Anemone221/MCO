import type {
  CharacterPlanProgress,
  GroupObjectiveStatus,
  PlanAnalysis,
  PlanSkillResolved,
  SkillPlan,
} from '@shared/types';
import { parseSkillPlan } from '../plans/parse';
import { UserFacingError } from '../errors';
import { analyzePlan } from '../plans/analyze';
import {
  buildSkillPrereqMap,
  objectiveProgress,
  type AnalysisCharacter,
  type SkillRequirement,
} from '../fits/analyze';
import { createPlan, getPlan, listPlans, updatePlan } from '../db/repositories/plans';
import {
  getSdeStatus,
  getSkillRanks,
  getSkillReqsForTypes,
  getTypeNames,
  resolveTypeIdsByName,
} from '../db/repositories/sde';
import { listCharacters } from '../db/repositories/characters';
import { getCharacterSkillMap } from '../db/repositories/skills';
import { getNeuralAttributes, getSkillTrainingAttributes } from './trainingData';

/** Parse a skill plan to validate it, then persist the raw text. */
export function importPlan(name: string, planText: string): SkillPlan {
  parseSkillPlan(planText);
  return createPlan({ name, planText });
}

/**
 * Overwrite a plan the creator re-saved. Updating in place rather than
 * replacing keeps every group priority and character-sheet card pointed at it.
 */
export function updatePlanById(planId: number, name: string, planText: string): SkillPlan {
  parseSkillPlan(planText);
  const updated = updatePlan(planId, { name, planText });
  if (!updated) throw new UserFacingError('That skill plan no longer exists.');
  return updated;
}

/** Analyse a stored skill plan across the whole character roster. */
export function analyzePlanById(planId: number): PlanAnalysis {
  const plan = getPlan(planId);
  if (!plan) throw new Error(`Unknown plan ${planId}`);

  const entries = parseSkillPlan(plan.planText);
  const { resolved } = resolveTypeIdsByName(entries.map((e) => e.skillName));
  const skills: PlanSkillResolved[] = entries.map((e) => ({
    skillName: e.skillName,
    skillTypeId: resolved.get(e.skillName) ?? null,
    level: e.level,
  }));
  const unresolved = skills.filter((s) => s.skillTypeId === null).map((s) => s.skillName);

  const sde = getSdeStatus();
  if (!sde.hasSkillData) {
    return {
      plan,
      skills,
      unresolved,
      needsSkillData: true,
      needsSkillAttributes: !sde.hasSkillAttributes,
      characters: [],
    };
  }

  const directReqs: SkillRequirement[] = skills
    .filter((s): s is PlanSkillResolved & { skillTypeId: number } => s.skillTypeId !== null)
    .map((s) => ({ skillTypeId: s.skillTypeId, level: s.level }));

  const { skillPrereqs, allSkillIds } = buildSkillPrereqMap(
    directReqs.map((r) => r.skillTypeId),
    getSkillReqsForTypes,
  );

  const characters: AnalysisCharacter[] = listCharacters().map((c) => ({
    characterId: c.id,
    characterName: c.name,
    skills: getCharacterSkillMap(c.id),
    attributes: getNeuralAttributes(c.id),
  }));

  const results = analyzePlan({
    directReqs,
    skillPrereqs,
    ranks: getSkillRanks(allSkillIds),
    skillNames: getTypeNames(allSkillIds),
    skillAttributes: getSkillTrainingAttributes(allSkillIds),
    characters,
  });

  return {
    plan,
    skills,
    unresolved,
    needsSkillData: false,
    needsSkillAttributes: !sde.hasSkillAttributes,
    characters: results,
  };
}

/** Per-plan completion for one character, for the character sheet's plans card. */
export function listPlanProgressForCharacter(characterId: number): {
  needsSkillData: boolean;
  plans: CharacterPlanProgress[];
} {
  const plans = listPlans();
  if (plans.length === 0) return { needsSkillData: false, plans: [] };
  if (!getSdeStatus().hasSkillData) return { needsSkillData: true, plans: [] };

  const skills = getCharacterSkillMap(characterId);
  const attributes = getNeuralAttributes(characterId);
  const progress = plans.map((plan) => {
    const entries = parseSkillPlan(plan.planText);
    const { resolved } = resolveTypeIdsByName(entries.map((e) => e.skillName));
    const directReqs: SkillRequirement[] = entries
      .filter((e) => resolved.has(e.skillName))
      .map((e) => ({ skillTypeId: resolved.get(e.skillName)!, level: e.level }));

    const { skillPrereqs, allSkillIds } = buildSkillPrereqMap(
      directReqs.map((r) => r.skillTypeId),
      getSkillReqsForTypes,
    );

    // Analysing a skill-less character alongside the real one yields the plan's
    // full from-zero SP cost with the same math that produces the real gap.
    const [zero, mine] = analyzePlan({
      directReqs,
      skillPrereqs,
      ranks: getSkillRanks(allSkillIds),
      skillNames: getTypeNames(allSkillIds),
      skillAttributes: getSkillTrainingAttributes(allSkillIds),
      characters: [
        { characterId: -1, characterName: '', skills: new Map() },
        { characterId, characterName: '', skills, attributes },
      ],
    });

    const totalSp = zero!.spGap;
    return {
      planId: plan.id,
      planName: plan.name,
      complete: mine!.complete,
      spGap: mine!.spGap,
      totalSp,
      progress: objectiveProgress(mine!.spGap, totalSp),
      lsiGap: mine!.lsiGap,
      timeGapMinutes: mine!.timeGapMinutes,
    };
  });
  return { needsSkillData: false, plans: progress };
}

/**
 * Skill status toward a plan for a specific character set, computed in one
 * analysis pass. A phantom zero-skill character yields the plan's from-zero SP
 * cost so each result carries a 0..1 progress share. Returns null when the
 * plan is gone or SDE skill data isn't imported.
 */
export function planObjectiveStatus(
  planId: number,
  characterIds: number[],
): Map<number, GroupObjectiveStatus> | null {
  const plan = getPlan(planId);
  if (!plan || !getSdeStatus().hasSkillData) return null;

  const entries = parseSkillPlan(plan.planText);
  const { resolved } = resolveTypeIdsByName(entries.map((e) => e.skillName));
  const directReqs: SkillRequirement[] = entries
    .filter((e) => resolved.has(e.skillName))
    .map((e) => ({ skillTypeId: resolved.get(e.skillName)!, level: e.level }));

  const { skillPrereqs, allSkillIds } = buildSkillPrereqMap(
    directReqs.map((r) => r.skillTypeId),
    getSkillReqsForTypes,
  );

  const characters: AnalysisCharacter[] = [
    { characterId: -1, characterName: '', skills: new Map() },
    ...characterIds.map((id) => ({
      characterId: id,
      characterName: '',
      skills: getCharacterSkillMap(id),
      attributes: getNeuralAttributes(id),
    })),
  ];

  const [zero, ...results] = analyzePlan({
    directReqs,
    skillPrereqs,
    ranks: getSkillRanks(allSkillIds),
    skillNames: getTypeNames(allSkillIds),
    skillAttributes: getSkillTrainingAttributes(allSkillIds),
    characters,
  });

  const totalSp = zero!.spGap;
  const statuses = new Map<number, GroupObjectiveStatus>();
  for (const r of results) {
    statuses.set(r.characterId, {
      complete: r.complete,
      spGap: r.spGap,
      totalSp,
      progress: objectiveProgress(r.spGap, totalSp),
      lsiGap: r.lsiGap,
      timeGapMinutes: r.timeGapMinutes,
      missingSkillCount: r.missingSkills.length,
    });
  }
  return statuses;
}
