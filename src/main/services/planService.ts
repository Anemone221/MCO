import type { PlanAnalysis, PlanSkillResolved, SkillPlan } from '@shared/types';
import { parseSkillPlan } from '../plans/parse';
import { analyzePlan } from '../plans/analyze';
import { buildSkillPrereqMap, type AnalysisCharacter, type SkillRequirement } from '../fits/analyze';
import { createPlan, getPlan } from '../db/repositories/plans';
import {
  getSdeStatus,
  getSkillRanks,
  getSkillReqsForTypes,
  getTypeNames,
  resolveTypeIdsByName,
} from '../db/repositories/sde';
import { listCharacters } from '../db/repositories/characters';
import { getCharacterSkillMap } from '../db/repositories/skills';

/** Parse a skill plan to validate it, then persist the raw text. */
export function importPlan(name: string, planText: string): SkillPlan {
  parseSkillPlan(planText);
  return createPlan({ name, planText });
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

  if (!getSdeStatus().hasSkillData) {
    return { plan, skills, unresolved, needsSkillData: true, characters: [] };
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
  }));

  const results = analyzePlan({
    directReqs,
    skillPrereqs,
    ranks: getSkillRanks(allSkillIds),
    skillNames: getTypeNames(allSkillIds),
    characters,
  });

  return { plan, skills, unresolved, needsSkillData: false, characters: results };
}
