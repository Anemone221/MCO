import {
  trainingAttributesFromIds,
  type NeuralAttributes,
  type SkillTrainingAttributes,
} from '../fits/cost';
import { spForLevel } from '../fits/analyze';
import { getSkillAttributes, getSkillRanks } from '../db/repositories/sde';
import { getCharacterAttributesRow } from '../db/repositories/characterAttributes';
import { getCharacterSkillMap, getQueue } from '../db/repositories/skills';
import { withFinishedQueue, type TrainedSkill } from '../skills/queue';

/**
 * A character's trained skills as the in-game client sees them: the stored
 * `/skills` snapshot plus every queue entry that has since finished (see
 * {@link withFinishedQueue}). Fit and plan analysis read this, never the raw
 * snapshot, so a skill that finished between syncs counts as trained.
 */
export function getEffectiveSkillMap(characterId: number): Map<number, TrainedSkill> {
  const skills = getCharacterSkillMap(characterId);
  const queue = getQueue(characterId);
  if (queue.length === 0) return skills;
  const ranks = getSkillRanks([...new Set(queue.map((q) => q.skillTypeId))]);
  return withFinishedQueue(skills, queue, (id, level) =>
    spForLevel(ranks.get(id) ?? 1, level),
  );
}

/**
 * Training attributes for the given skills, keyed by skill type id. Skills the
 * SDE lacks data for (or with unmappable attribute ids) are omitted, which
 * nulls the time metric for characters missing those skills.
 */
export function getSkillTrainingAttributes(
  skillTypeIds: number[],
): Map<number, SkillTrainingAttributes> {
  const result = new Map<number, SkillTrainingAttributes>();
  for (const [skillTypeId, row] of getSkillAttributes(skillTypeIds)) {
    const attrs = trainingAttributesFromIds(row.primaryAttributeId, row.secondaryAttributeId);
    if (attrs !== null) result.set(skillTypeId, attrs);
  }
  return result;
}

/** A character's neural attributes for training-time math; null until synced. */
export function getNeuralAttributes(characterId: number): NeuralAttributes | null {
  const row = getCharacterAttributesRow(characterId);
  if (row === null) return null;
  return {
    charisma: row.charisma,
    intelligence: row.intelligence,
    memory: row.memory,
    perception: row.perception,
    willpower: row.willpower,
  };
}
