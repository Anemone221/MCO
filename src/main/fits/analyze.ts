import type { FitCharacterResult, MissingSkill } from '@shared/types';

export interface SkillRequirement {
  skillTypeId: number;
  level: number;
}

export interface AnalysisCharacter {
  characterId: number;
  characterName: string;
  skills: Map<number, { sp: number; trainedLevel: number }>;
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
  characters: AnalysisCharacter[];
}

/** Total skill points needed to hold a skill at the given level (0 for level 0). */
export function spForLevel(rank: number, level: number): number {
  if (level <= 0) return 0;
  return Math.round(250 * rank * Math.sqrt(32) ** (level - 1));
}

function maxMerge(map: Map<number, number>, skillTypeId: number, level: number): void {
  const existing = map.get(skillTypeId);
  if (existing === undefined || level > existing) map.set(skillTypeId, level);
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

    return {
      characterId: char.characterId,
      characterName: char.characterName,
      canFly,
      spGap,
      missingSkills,
    };
  });
}
