/**
 * The neural attributes the plan creator prices training time at.
 *
 * A plan is written for a character who doesn't have it yet, and often for one
 * who will remap before training it, so this is a *setting* rather than synced
 * data: it starts at an even remap and the user adjusts it. Kept per profile in
 * localStorage, like the cost-system thresholds (`lib/costView.ts`).
 */

import type { NeuralAttributes, TrainingAttribute } from '@shared/types';
import {
  BALANCED_ATTRIBUTES,
  MAX_ATTRIBUTE,
  MIN_ATTRIBUTE,
  TRAINING_ATTRIBUTES,
} from '@shared/training';

const STORAGE_KEY = 'mco.planAttributes';

/** Hold one attribute inside what EVE can actually produce. */
export function clampAttribute(value: number): number {
  if (!Number.isFinite(value)) return MIN_ATTRIBUTE;
  return Math.min(MAX_ATTRIBUTE, Math.max(MIN_ATTRIBUTE, Math.round(value)));
}

export function withAttribute(
  attributes: NeuralAttributes,
  attribute: TrainingAttribute,
  value: number,
): NeuralAttributes {
  return { ...attributes, [attribute]: clampAttribute(value) };
}

/** The saved attributes, or the even remap when nothing valid is stored. */
export function loadPlanAttributes(): NeuralAttributes {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return BALANCED_ATTRIBUTES;
    const parsed = JSON.parse(raw) as Partial<Record<TrainingAttribute, unknown>>;
    const attributes = { ...BALANCED_ATTRIBUTES };
    for (const attribute of TRAINING_ATTRIBUTES) {
      const value = parsed[attribute];
      if (typeof value === 'number') attributes[attribute] = clampAttribute(value);
    }
    return attributes;
  } catch {
    // Unreadable or corrupt storage is not worth an error state — a plan
    // priced at the even remap is still a useful plan.
    return BALANCED_ATTRIBUTES;
  }
}

export function savePlanAttributes(attributes: NeuralAttributes): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(attributes));
  } catch {
    // Storage full or blocked: the session keeps the value, it just won't persist.
  }
}

/** Whether these are still the even remap the creator starts from. */
export function isBalanced(attributes: NeuralAttributes): boolean {
  return TRAINING_ATTRIBUTES.every(
    (attribute) => attributes[attribute] === BALANCED_ATTRIBUTES[attribute],
  );
}
