import type { FitCharacterResult, MissingSkill } from '@shared/types';
import {
  injectorsForGap,
  trainingTimeMinutes,
  type NeuralAttributes,
  type SkillTrainingAttributes,
} from './cost';

export interface SkillRequirement {
  skillTypeId: number;
  level: number;
}

export interface AnalysisCharacter {
  characterId: number;
  characterName: string;
  skills: Map<number, { sp: number; trainedLevel: number }>;
  /** Neural attributes for the time metric; null/absent -> timeGapMinutes null. */
  attributes?: NeuralAttributes | null;
}

export interface FitAnalysisInput {
  /** Skill requirements of the counted fit types (modules, charges, drones, hull). */
  directReqs: SkillRequirement[];
  /** Skill type id -> that skill's own prerequisite skills, for the closure. */
  skillPrereqs: Map<number, SkillRequirement[]>;
  /** Skill type id -> skillTimeConstant (rank). */
  ranks: Map<number, number>;
  /** Skill type id -> display name. */
  skillNames: Map<number, string>;
  /** Skill type id -> training attributes; absent entries null the time metric. */
  skillAttributes?: Map<number, SkillTrainingAttributes>;
  characters: AnalysisCharacter[];
}

/** Total skill points needed to hold a skill at the given level (0 for level 0). */
export function spForLevel(rank: number, level: number): number {
  if (level <= 0) return 0;
  return Math.round(250 * rank * Math.sqrt(32) ** (level - 1));
}

/** 0..1 share of an objective's from-zero SP a character already holds. */
export function objectiveProgress(spGap: number, totalSp: number): number {
  if (totalSp === 0) return 1;
  return Math.min(1, Math.max(0, 1 - spGap / totalSp));
}

function maxMerge(map: Map<number, number>, skillTypeId: number, level: number): void {
  const existing = map.get(skillTypeId);
  if (existing === undefined || level > existing) map.set(skillTypeId, level);
}

export interface PrereqRow {
  typeId: number;
  skillTypeId: number;
  level: number;
}

export interface SkillPrereqClosure {
  /** Type/skill id -> that id's own direct skill requirements. */
  skillPrereqs: Map<number, SkillRequirement[]>;
  /** Every id discovered while walking the closure (seeds + transitive prereqs). */
  allSkillIds: number[];
}

/**
 * Walk the transitive prerequisite tree of a seed list of type ids (a fit's
 * counted items, or a skill plan's own listed skills). `fetchReqs` mirrors
 * the sde repository's getSkillReqsForTypes: given a batch of type ids,
 * return their direct skill requirements.
 */
export function buildSkillPrereqMap(
  seedTypeIds: number[],
  fetchReqs: (typeIds: number[]) => PrereqRow[],
): SkillPrereqClosure {
  const skillPrereqs = new Map<number, SkillRequirement[]>();
  const seen = new Set<number>(seedTypeIds);
  let frontier = [...seen];
  while (frontier.length > 0) {
    const next: number[] = [];
    for (const row of fetchReqs(frontier)) {
      const list = skillPrereqs.get(row.typeId) ?? [];
      list.push({ skillTypeId: row.skillTypeId, level: row.level });
      skillPrereqs.set(row.typeId, list);
      if (!seen.has(row.skillTypeId)) {
        seen.add(row.skillTypeId);
        next.push(row.skillTypeId);
      }
    }
    frontier = next;
  }
  return { skillPrereqs, allSkillIds: [...seen] };
}

/**
 * Expand a required-skill set through skill prerequisites. Each skill's prereqs
 * are demanded at their own fixed level (the level needed to train that skill).
 */
export function expandClosure(
  direct: Map<number, number>,
  skillPrereqs: Map<number, SkillRequirement[]>,
): Map<number, number> {
  const closure = new Map(direct);
  const queue = [...direct.keys()];
  while (queue.length > 0) {
    const skillId = queue.shift()!;
    for (const prereq of skillPrereqs.get(skillId) ?? []) {
      const before = closure.get(prereq.skillTypeId);
      maxMerge(closure, prereq.skillTypeId, prereq.level);
      if (before === undefined || prereq.level > before) queue.push(prereq.skillTypeId);
    }
  }
  return closure;
}

/**
 * Compute, per character: whether they can fly the fit, and if not, the total
 * SP gap (including untrained prerequisite skills) to close it.
 */
export function analyzeFit(input: FitAnalysisInput): FitCharacterResult[] {
  const requiredDirect = new Map<number, number>();
  for (const req of input.directReqs) maxMerge(requiredDirect, req.skillTypeId, req.level);

  const closure = expandClosure(requiredDirect, input.skillPrereqs);

  return input.characters.map((char) => {
    let canFly = true;
    for (const [skillId, level] of requiredDirect) {
      if ((char.skills.get(skillId)?.trainedLevel ?? 0) < level) {
        canFly = false;
        break;
      }
    }

    const missingSkills: MissingSkill[] = [];
    let spGap = 0;
    for (const [skillId, needLevel] of closure) {
      const owned = char.skills.get(skillId);
      const rank = input.ranks.get(skillId) ?? 1;
      const delta = Math.max(0, spForLevel(rank, needLevel) - (owned?.sp ?? 0));
      if (delta > 0) {
        spGap += delta;
        missingSkills.push({
          skillTypeId: skillId,
          skillName: input.skillNames.get(skillId) ?? null,
          haveLevel: owned?.trainedLevel ?? 0,
          needLevel,
          spDelta: delta,
        });
      }
    }
    missingSkills.sort((a, b) => b.spDelta - a.spDelta);

    let totalSp = 0;
    for (const owned of char.skills.values()) totalSp += owned.sp;

    return {
      characterId: char.characterId,
      characterName: char.characterName,
      canFly,
      spGap,
      lsiGap: injectorsForGap(totalSp, spGap),
      timeGapMinutes: trainingTimeMinutes(
        missingSkills,
        input.skillAttributes ?? new Map(),
        char.attributes ?? null,
      ),
      missingSkills,
    };
  });
}
