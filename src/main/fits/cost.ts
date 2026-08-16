import type { NeuralAttributes, TrainingAttribute } from '@shared/types';
import { spPerMinute } from '@shared/training';

export type { NeuralAttributes, TrainingAttribute };
export { spPerMinute };

export interface SkillTrainingAttributes {
  primary: TrainingAttribute;
  secondary: TrainingAttribute;
}

/** Dogma attribute ids used as *values* of primaryAttribute/secondaryAttribute (180/181). */
const ATTRIBUTE_BY_ID: ReadonlyMap<number, TrainingAttribute> = new Map([
  [164, 'charisma'],
  [165, 'intelligence'],
  [166, 'memory'],
  [167, 'perception'],
  [168, 'willpower'],
]);

export function trainingAttributeFromId(attributeId: number): TrainingAttribute | null {
  return ATTRIBUTE_BY_ID.get(attributeId) ?? null;
}

export function trainingAttributesFromIds(
  primaryAttributeId: number,
  secondaryAttributeId: number,
): SkillTrainingAttributes | null {
  const primary = trainingAttributeFromId(primaryAttributeId);
  const secondary = trainingAttributeFromId(secondaryAttributeId);
  if (primary === null || secondary === null) return null;
  return { primary, secondary };
}

/**
 * SP granted by one Large Skill Injector at the given total SP. Boundaries
 * belong to the lower yield, matching the in-game "80m or more" wording.
 */
export function injectorYield(totalSp: number): number {
  if (totalSp < 5_000_000) return 500_000;
  if (totalSp < 50_000_000) return 400_000;
  if (totalSp < 80_000_000) return 300_000;
  return 150_000;
}

/**
 * Whole Large Skill Injectors needed to cover spGap, simulated sequentially:
 * total SP grows with each injection and may cross yield tiers mid-way.
 */
export function injectorsForGap(totalSp: number, spGap: number): number {
  let sp = totalSp;
  let remaining = spGap;
  let count = 0;
  while (remaining > 0) {
    const granted = injectorYield(sp);
    remaining -= granted;
    sp += granted;
    count += 1;
  }
  return count;
}

/**
 * Total minutes to train a missing-skill list at the character's current
 * attributes, or null when unknowable: attributes never synced, any skill
 * absent from the training-attribute map (a partial sum would understate the
 * cost), or a non-positive rate. An empty list is 0 even without attributes —
 * a capable character costs nothing.
 */
export function trainingTimeMinutes(
  missing: ReadonlyArray<{ skillTypeId: number; spDelta: number }>,
  skillAttributes: ReadonlyMap<number, SkillTrainingAttributes>,
  attrs: NeuralAttributes | null,
): number | null {
  if (missing.length === 0) return 0;
  if (attrs === null) return null;
  let minutes = 0;
  for (const skill of missing) {
    const training = skillAttributes.get(skill.skillTypeId);
    if (training === undefined) return null;
    const rate = spPerMinute(attrs, training);
    if (!Number.isFinite(rate) || rate <= 0) return null;
    minutes += skill.spDelta / rate;
  }
  return minutes;
}
