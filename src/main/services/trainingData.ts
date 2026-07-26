import {
  trainingAttributesFromIds,
  type NeuralAttributes,
  type SkillTrainingAttributes,
} from '../fits/cost';
import { getSkillAttributes } from '../db/repositories/sde';
import { getCharacterAttributesRow } from '../db/repositories/characterAttributes';

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
