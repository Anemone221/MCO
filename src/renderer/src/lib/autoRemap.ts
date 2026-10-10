/**
 * Auto remap: decide where a plan's remap points should go, reorder the queue
 * so the skills that suit each remap train under it, and say what to remap to.
 *
 * The model: the queue splits into segments — segment 0 trains at the
 * character's starting attributes (fixed: that is what they have now), each
 * later one at a remap. Order *inside* a segment never changes its time, so the
 * whole problem is which segment each row trains in, subject to one rule: a row
 * can never sit in an earlier segment than something it needs (a prerequisite
 * or its own lower level). Lay the rows out segment by segment and the remaps
 * fall on the segment boundaries.
 *
 * The search is a small alternating one, run from several starts: aim each
 * remap at one of the plan's heaviest attribute pairs, give every row the
 * cheapest segment its dependencies allow, re-optimise each segment's remap for
 * the rows it ended up with (`bestArrangement`, the same exact search as
 * *Optimize*), and repeat until nothing moves. The best result over all starts
 * wins. It is a heuristic over the assignment — the attribute search inside it
 * is exact — and it is checked against the plan as it stands, so it never
 * hands back something slower.
 *
 * Pure, like `planDraft.ts`: no IPC, no React.
 */

import type { NeuralAttributes, PlanDraftEntry, TrainingAttribute } from '@shared/types';
import { spPerMinute, TRAINING_ATTRIBUTES } from '@shared/training';
import {
  bestArrangement,
  draftTotals,
  entryKey,
  type PairBucket,
  type SkillMap,
} from './planDraft';

/** How many remap points auto remap will place at most. */
export const MAX_AUTO_REMAPS = 3;

/** How many of the plan's heaviest attribute pairs seed the search. */
const SEED_PAIRS = 5;

/** Alternations per start before giving up on settling. */
const MAX_ROUNDS = 12;

/** One remap point auto remap placed, as the result card lists it. */
export interface AutoRemapPoint {
  /** Row index in the new queue the remap sits above. */
  index: number;
  skillName: string;
  level: number;
  attributes: NeuralAttributes;
  /** The attributes in force just before it — what the remap swaps away from. */
  previous: NeuralAttributes;
  /** How much faster its rows train than they would at `previous`. */
  savedMinutes: number;
}

export interface AutoRemapResult {
  /** The reordered queue, carrying the new remap points (and no others). */
  entries: PlanDraftEntry[];
  points: AutoRemapPoint[];
  beforeMinutes: number;
  afterMinutes: number;
  /** Rows that now sit at a different position than before. */
  moved: number;
}

interface Row {
  entry: PlanDraftEntry;
  pair: { primary: TrainingAttribute; secondary: TrainingAttribute } | null;
  /** SP this row's own step costs (from the highest lower level the plan holds). */
  sp: number;
  preds: number[];
  succs: number[];
}

function pairKey(pair: { primary: TrainingAttribute; secondary: TrainingAttribute }): string {
  return `${pair.primary}/${pair.secondary}`;
}

function sameAttributes(a: NeuralAttributes, b: NeuralAttributes): boolean {
  return TRAINING_ATTRIBUTES.every((attribute) => a[attribute] === b[attribute]);
}

/**
 * The rows, their step SP and their dependency edges: a level needs every
 * lower level of its skill the plan holds, and every row of each prerequisite
 * skill up to the level it requires. Prerequisites the plan never trains add
 * no edge — the character may already have them.
 */
function buildRows(entries: readonly PlanDraftEntry[], skills: SkillMap): Row[] {
  const bySkill = new Map<number, number[]>();
  entries.forEach((entry, index) => {
    if (entry.skillTypeId === null) return;
    const list = bySkill.get(entry.skillTypeId) ?? [];
    list.push(index);
    bySkill.set(entry.skillTypeId, list);
  });

  const rows: Row[] = entries.map((entry) => ({ entry, pair: null, sp: 0, preds: [], succs: [] }));

  rows.forEach((row, index) => {
    const { skillTypeId, level } = row.entry;
    if (skillTypeId === null) return;
    const skill = skills.get(skillTypeId);
    const preds = new Set<number>();

    let from = 0;
    for (const other of bySkill.get(skillTypeId) ?? []) {
      const otherLevel = entries[other]!.level;
      if (otherLevel < level) {
        preds.add(other);
        from = Math.max(from, otherLevel);
      }
    }
    for (const prereq of skill?.prereqs ?? []) {
      for (const other of bySkill.get(prereq.skillTypeId) ?? []) {
        if (entries[other]!.level <= prereq.level) preds.add(other);
      }
    }
    preds.delete(index);
    row.preds = [...preds];

    const spAtLevel = skill?.spAtLevel;
    const target = spAtLevel?.[level - 1];
    if (target !== undefined && skill?.primaryAttribute && skill.secondaryAttribute) {
      row.sp = Math.max(0, target - (from > 0 ? (spAtLevel![from - 1] ?? 0) : 0));
      row.pair = { primary: skill.primaryAttribute, secondary: skill.secondaryAttribute };
    }
  });

  rows.forEach((row, index) => {
    for (const pred of row.preds) rows[pred]!.succs.push(index);
  });
  return rows;
}

/**
 * A training order: every row after everything it needs, and among the rows
 * that are ready, the lowest `priority` first. A dependency cycle (only a
 * corrupt import could make one) is broken by taking the lowest priority left.
 */
function topoOrder(rows: readonly Row[], priority: (index: number) => number): number[] {
  const waiting = rows.map((row) => row.preds.length);
  const done = new Array<boolean>(rows.length).fill(false);
  const order: number[] = [];

  while (order.length < rows.length) {
    let pick = -1;
    let fallback = -1;
    for (let index = 0; index < rows.length; index += 1) {
      if (done[index]) continue;
      if (fallback === -1 || priority(index) < priority(fallback)) fallback = index;
      if (waiting[index] === 0 && (pick === -1 || priority(index) < priority(pick))) pick = index;
    }
    const chosen = pick === -1 ? fallback : pick;
    done[chosen] = true;
    order.push(chosen);
    for (const succ of rows[chosen]!.succs) waiting[succ] = Math.max(0, waiting[succ]! - 1);
  }
  return order;
}

/** Minutes one row takes at one attribute set. */
function rowMinutes(row: Row, attributes: NeuralAttributes): number {
  if (!row.pair || row.sp === 0) return 0;
  const rate = spPerMinute(attributes, row.pair);
  return rate > 0 ? row.sp / rate : 0;
}

function bucketsFor(rows: readonly Row[], members: readonly number[]): PairBucket[] {
  const byPair = new Map<string, PairBucket>();
  for (const index of members) {
    const row = rows[index]!;
    if (!row.pair || row.sp === 0) continue;
    const key = pairKey(row.pair);
    const bucket = byPair.get(key);
    if (bucket) bucket.sp += row.sp;
    else byPair.set(key, { ...row.pair, sp: row.sp });
  }
  return [...byPair.values()];
}

/**
 * Settle one start: alternate "every row to its cheapest legal segment" with
 * "every remap re-optimised for its rows" until the assignment stops moving.
 */
function settle(
  rows: readonly Row[],
  topo: readonly number[],
  base: NeuralAttributes,
  seeds: readonly NeuralAttributes[],
  arrange: (buckets: PairBucket[]) => NeuralAttributes,
): { segment: number[]; attributes: NeuralAttributes[]; minutes: number } {
  const last = seeds.length;
  let attributes = [base, ...seeds];
  const segment = new Array<number>(rows.length).fill(0);

  const cheapest = (index: number, low: number, high: number, keep: number): number => {
    let best = keep >= low && keep <= high ? keep : low;
    let bestMinutes = rowMinutes(rows[index]!, attributes[best]!);
    for (let k = low; k <= high; k += 1) {
      const minutes = rowMinutes(rows[index]!, attributes[k]!);
      if (minutes < bestMinutes - 1e-9) {
        best = k;
        bestMinutes = minutes;
      }
    }
    return best;
  };
  const lowFor = (index: number): number =>
    rows[index]!.preds.reduce((low, pred) => Math.max(low, segment[pred]!), 0);
  const highFor = (index: number): number =>
    rows[index]!.succs.reduce((high, succ) => Math.min(high, segment[succ]!), last);

  // First placement: forward through the dependencies, each row as cheap as
  // what it needs allows. Ties go to the earliest segment.
  for (const index of topo) segment[index] = cheapest(index, lowFor(index), last, -1);

  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    attributes = [
      base,
      ...seeds.map((seed, i) => {
        const members = rows.map((_, index) => index).filter((index) => segment[index] === i + 1);
        const buckets = bucketsFor(rows, members);
        return buckets.length === 0 ? (attributes[i + 1] ?? seed) : arrange(buckets);
      }),
    ];

    // Back to front lets a chain move later tail-first; front to back lets
    // it move earlier head-first. Repeat until both directions are quiet.
    let changed = false;
    for (let pass = 0; pass < rows.length; pass += 1) {
      let passChanged = false;
      for (const order of [[...topo].reverse(), topo]) {
        for (const index of order) {
          const next = cheapest(index, lowFor(index), highFor(index), segment[index]!);
          if (next !== segment[index]) {
            segment[index] = next;
            passChanged = true;
          }
        }
      }
      if (!passChanged) break;
      changed = true;
    }
    if (!changed && round > 0) break;
  }

  const minutes = rows.reduce((sum, row, index) => sum + rowMinutes(row, attributes[segment[index]!]!), 0);
  return { segment, attributes, minutes };
}

/** Every ordered pick of `count` items from `items` (no repeats). */
function orderedPicks<T>(items: readonly T[], count: number): T[][] {
  if (count === 0) return [[]];
  const out: T[][] = [];
  items.forEach((item, i) => {
    const rest = items.filter((_, j) => j !== i);
    for (const tail of orderedPicks(rest, count - 1)) out.push([item, ...tail]);
  });
  return out;
}

/**
 * Place up to `remaps` remap points in a plan, reordering it so each remap
 * covers the skills it suits. Any remap points already in the plan are
 * replaced. The starting attributes are kept as they are; each remap uses the
 * same total, so implants carry across.
 *
 * Returns null when there is nothing to work with (no rows, or no row with
 * cost data). Otherwise the result always comes back — the caller compares
 * `afterMinutes` with `beforeMinutes` to decide whether it is worth applying.
 */
export function autoRemap(
  entries: readonly PlanDraftEntry[],
  skills: SkillMap,
  base: NeuralAttributes,
  remaps: number,
): AutoRemapResult | null {
  const count = Math.max(1, Math.min(MAX_AUTO_REMAPS, Math.floor(remaps)));
  const plain = entries.map((entry) => {
    const copy = { ...entry };
    delete copy.remapBefore;
    return copy;
  });
  const rows = buildRows(plain, skills);

  const spByPair = new Map<string, PairBucket>();
  for (const bucket of bucketsFor(rows, rows.map((_, index) => index))) {
    spByPair.set(pairKey(bucket), bucket);
  }
  if (spByPair.size === 0) return null;

  // The same plan segment comes up over and over across starts; the exact
  // search is cheap, but not free.
  const memo = new Map<string, NeuralAttributes>();
  const arrange = (buckets: PairBucket[]): NeuralAttributes => {
    const key = buckets
      .map((bucket) => `${pairKey(bucket)}:${bucket.sp}`)
      .sort()
      .join('|');
    let found = memo.get(key);
    if (!found) {
      found = bestArrangement(buckets, base);
      memo.set(key, found);
    }
    return found;
  };

  const topo = topoOrder(rows, (index) => index);
  const heaviest = [...spByPair.values()].sort((a, b) => b.sp - a.sp).slice(0, SEED_PAIRS);
  const ideals = heaviest.map((bucket) => arrange([bucket]));

  let best: ReturnType<typeof settle> | null = null;
  for (const seeds of orderedPicks(ideals, Math.min(count, ideals.length))) {
    const result = settle(rows, topo, base, seeds, arrange);
    if (best === null || result.minutes < best.minutes - 1e-9) best = result;
  }
  const { segment, attributes } = best!;

  // Lay the rows out segment by segment, the author's order kept inside each.
  const order = topoOrder(rows, (index) => segment[index]! * rows.length + index);

  // A remap goes where the attributes actually change; a segment that ended up
  // with the same set as the one before it simply continues it.
  const out: PlanDraftEntry[] = [];
  const points: AutoRemapPoint[] = [];
  let inForce = base;
  order.forEach((index, position) => {
    const entry = plain[index]!;
    const target = attributes[segment[index]!]!;
    if (sameAttributes(target, inForce)) {
      out.push(entry);
      return;
    }
    points.push({
      index: position,
      skillName: entry.skillName,
      level: entry.level,
      attributes: target,
      previous: inForce,
      savedMinutes: 0,
    });
    out.push({ ...entry, remapBefore: target });
    inForce = target;
  });

  // What each remap is worth: every row it governs, at it versus at the set it replaced.
  points.forEach((point, i) => {
    const end = points[i + 1]?.index ?? order.length;
    for (let position = point.index; position < end; position += 1) {
      const row = rows[order[position]!]!;
      point.savedMinutes += rowMinutes(row, point.previous) - rowMinutes(row, point.attributes);
    }
  });

  const moved = out.filter((entry, i) => entryKey(entry) !== entryKey(entries[i]!)).length;
  return {
    entries: out,
    points,
    beforeMinutes: draftTotals(entries, skills, base).minutes,
    afterMinutes: draftTotals(out, skills, base).minutes,
    moved,
  };
}
