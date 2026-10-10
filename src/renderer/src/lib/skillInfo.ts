import type { NeuralAttributes, PlanSkillInfo } from '@shared/types';
import { spPerMinute } from '@shared/training';

/** One level of a skill as the info card lists it. */
export interface SkillLevelRow {
  level: number;
  /** Total SP held at this level. */
  sp: number;
  /** Minutes to train from the level below to this one; null without attribute data. */
  minutes: number | null;
}

/**
 * Every level I–V of a skill with its SP and the time each step takes at the
 * given attributes — the same rule the plan's own Time column uses.
 */
export function skillLevelRows(
  skill: PlanSkillInfo,
  attributes: NeuralAttributes,
): SkillLevelRow[] {
  const rate =
    skill.primaryAttribute && skill.secondaryAttribute
      ? spPerMinute(attributes, {
          primary: skill.primaryAttribute,
          secondary: skill.secondaryAttribute,
        })
      : null;
  return skill.spAtLevel.map((sp, index) => {
    const step = sp - (index > 0 ? (skill.spAtLevel[index - 1] ?? 0) : 0);
    return {
      level: index + 1,
      sp,
      minutes: rate !== null && Number.isFinite(rate) && rate > 0 ? step / rate : null,
    };
  });
}

/**
 * The published skills that list this one as a prerequisite, with the level
 * they need — what training it unlocks. Sorted by level, then name.
 */
export function skillDependents(
  catalog: readonly PlanSkillInfo[],
  skillTypeId: number,
): Array<{ skill: PlanSkillInfo; level: number }> {
  const found: Array<{ skill: PlanSkillInfo; level: number }> = [];
  for (const skill of catalog) {
    if (!skill.published) continue;
    const req = skill.prereqs.find((p) => p.skillTypeId === skillTypeId);
    if (req) found.push({ skill, level: req.level });
  }
  return found.sort((a, b) => a.level - b.level || a.skill.name.localeCompare(b.skill.name));
}
