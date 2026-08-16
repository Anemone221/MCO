import type { NeuralAttributes, TrainingAttribute } from './types';

/**
 * EVE's training-speed rule, shared because both sides need it: the main
 * process prices a character's real gap (`main/fits/cost.ts`) and the plan
 * creator prices a draft against attributes the user is only *planning* to
 * have (`renderer/lib/planDraft.ts`). One copy, so the two can't drift.
 */
export function spPerMinute(
  attributes: NeuralAttributes,
  skill: { primary: TrainingAttribute; secondary: TrainingAttribute },
): number {
  return attributes[skill.primary] + attributes[skill.secondary] / 2;
}

/**
 * An even remap, which is what the creator estimates with until told otherwise.
 *
 * Every attribute sits at 17 before remapping, with 14 points to spread and a
 * ceiling of 27 on any one of them — 99 points in total (the "perfect" remap
 * everyone quotes, 27 primary / 21 secondary / 17 × 3, is the same 99). Spread
 * evenly that is 20 across the board with the spare point off charisma, the
 * attribute the fewest skills train against.
 */
export const BALANCED_ATTRIBUTES: NeuralAttributes = {
  charisma: 19,
  intelligence: 20,
  memory: 20,
  perception: 20,
  willpower: 20,
};

/** Every attribute EVE will accept, low to high (17 base, 27 remap cap, implants above). */
export const MIN_ATTRIBUTE = 17;
export const MAX_ATTRIBUTE = 40;

/**
 * How far apart a remap can push two attributes: 27 − 17. Implants raise every
 * attribute together, so they shift the window without widening it — which is
 * what lets the optimiser rearrange a set of attributes without being told how
 * much of it is implants.
 */
export const REMAP_SPREAD = 10;

/**
 * What a remapped character's five attributes add up to before implants: 17
 * each plus the 14 points a remap spreads. The "perfect" remap everyone quotes
 * — 27 primary, 21 secondary, 17 × 3 — comes to the same 99.
 */
export const ATTRIBUTE_POOL = 5 * MIN_ATTRIBUTE + 14;

/**
 * The window a set of attributes can be rearranged within, given only their
 * total. Anything above the un-implanted pool must be implants, and implants
 * are worn across all five attributes, so the whole 17–27 remap window slides
 * up by that much rather than widening.
 */
export function remapWindow(total: number): { low: number; high: number } {
  const implants = Math.max(0, (total - ATTRIBUTE_POOL) / 5);
  return {
    low: Math.ceil(MIN_ATTRIBUTE + implants),
    high: Math.floor(MIN_ATTRIBUTE + REMAP_SPREAD + implants),
  };
}

/** The five attributes in the order the UI lists them. */
export const TRAINING_ATTRIBUTES: readonly TrainingAttribute[] = [
  'intelligence',
  'memory',
  'perception',
  'willpower',
  'charisma',
];

const ATTRIBUTE_ABBR: Record<TrainingAttribute, string> = {
  charisma: 'Cha',
  intelligence: 'Int',
  memory: 'Mem',
  perception: 'Per',
  willpower: 'Wil',
};

/** Three-letter attribute label, or "—" when the SDE has no attribute data. */
export function attributeAbbr(attribute: TrainingAttribute | null | undefined): string {
  return attribute ? ATTRIBUTE_ABBR[attribute] : '—';
}
