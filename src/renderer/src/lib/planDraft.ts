/**
 * The skill-plan creator's draft: an ordered training queue, one row per skill
 * *level*, plus the pure operations the page performs on it — raising or
 * lowering a skill, pulling in the prerequisites a level implies, reordering,
 * costing in SP and time, and rendering the text that goes to the clipboard or
 * to a saved plan.
 *
 * Nothing here touches IPC or React. The main process supplies the skill
 * catalogue (`PlanSkillInfo`, including each level's SP so this never re-derives
 * EVE's SP formula); everything the user does to the draft happens here.
 */

import type {
  NeuralAttributes,
  PlanDraftEntry,
  PlanSkillInfo,
  TrainingAttribute,
} from '@shared/types';
import { remapWindow, spPerMinute, TRAINING_ATTRIBUTES } from '@shared/training';
import { romanLevel } from './format';

/** Skill data keyed by type id — the catalogue, as the page holds it. */
export type SkillMap = ReadonlyMap<number, PlanSkillInfo>;

/** A skill+level pair to add to a draft (a fit requirement, a browser pick). */
export interface DraftRequirement {
  skillTypeId: number;
  level: number;
}

export const MAX_LEVEL = 5;

/**
 * A row's identity, stable across reordering. Every level is its own row, so a
 * skill and a level name exactly one row.
 */
export function entryKey(entry: PlanDraftEntry): string {
  return entry.skillTypeId === null
    ? `name:${entry.skillName.toLowerCase()}:${entry.level}`
    : `${entry.skillTypeId}:${entry.level}`;
}

/** Index the catalogue (or merge a later fetch into an existing index). */
export function mergeSkills(existing: SkillMap, incoming: PlanSkillInfo[]): SkillMap {
  const next = new Map(existing);
  for (const skill of incoming) next.set(skill.skillTypeId, skill);
  return next;
}

/** The highest level a skill is queued to, or 0 when it isn't in the draft. */
export function planLevel(entries: readonly PlanDraftEntry[], skillTypeId: number): number {
  let level = 0;
  for (const entry of entries) {
    if (entry.skillTypeId === skillTypeId && entry.level > level) level = entry.level;
  }
  return level;
}

function skillName(skills: SkillMap, skillTypeId: number): string {
  return skills.get(skillTypeId)?.name ?? `Skill ${skillTypeId}`;
}

/**
 * Queue one requirement: everything it needs first, then a row per level the
 * draft is still missing. Levels already queued are left where they are —
 * raising Gunnery from III to V appends IV and V, it doesn't restate I–III.
 */
function appendWithPrereqs(
  out: PlanDraftEntry[],
  { skillTypeId, level }: DraftRequirement,
  skills: SkillMap,
  visiting: Set<number>,
): void {
  if (planLevel(out, skillTypeId) >= level) return;
  // The SDE's prerequisite tree is acyclic; the guard is so a bad import can
  // never spin here.
  if (visiting.has(skillTypeId)) return;

  visiting.add(skillTypeId);
  for (const prereq of skills.get(skillTypeId)?.prereqs ?? []) {
    appendWithPrereqs(out, prereq, skills, visiting);
  }
  visiting.delete(skillTypeId);

  const name = skillName(skills, skillTypeId);
  for (let next = planLevel(out, skillTypeId) + 1; next <= level; next += 1) {
    out.push({ skillTypeId, skillName: name, level: next });
  }
}

/**
 * Add requirements to the end of a draft, each preceded by the prerequisites it
 * implies. Used by the browser's + button (one requirement) and by fit import
 * (every skill a hull and its modules need at once).
 */
export function addRequirements(
  entries: readonly PlanDraftEntry[],
  requirements: readonly DraftRequirement[],
  skills: SkillMap,
): PlanDraftEntry[] {
  const next = [...entries];
  for (const requirement of requirements) {
    appendWithPrereqs(next, requirement, skills, new Set());
  }
  return next;
}

/** Raise a skill one level (the browser's + button). */
export function raiseSkill(
  entries: readonly PlanDraftEntry[],
  skillTypeId: number,
  skills: SkillMap,
): PlanDraftEntry[] {
  const level = planLevel(entries, skillTypeId) + 1;
  if (level > MAX_LEVEL) return [...entries];
  return addRequirements(entries, [{ skillTypeId, level }], skills);
}

/**
 * Drop a level and every level above it. Removing the middle of a skill's
 * queue would leave a level that can't train, so `-` on III takes IV and V with
 * it — and `-` on I removes the skill from the plan.
 */
export function removeFromLevel(
  entries: readonly PlanDraftEntry[],
  skillTypeId: number,
  level: number,
): PlanDraftEntry[] {
  return entries.filter(
    (entry) => entry.skillTypeId !== skillTypeId || entry.level < level,
  );
}

/** Lower a skill by one level (the browser's − button). */
export function lowerSkill(
  entries: readonly PlanDraftEntry[],
  skillTypeId: number,
): PlanDraftEntry[] {
  const level = planLevel(entries, skillTypeId);
  if (level === 0) return [...entries];
  return removeFromLevel(entries, skillTypeId, level);
}

/** Remove one row by key — for lines whose skill the SDE doesn't know. */
export function removeEntry(entries: readonly PlanDraftEntry[], key: string): PlanDraftEntry[] {
  return entries.filter((entry) => entryKey(entry) !== key);
}

/** Move the entry at `from` so that it sits at index `to`. */
export function moveEntry(
  entries: readonly PlanDraftEntry[],
  from: number,
  to: number,
): PlanDraftEntry[] {
  if (from === to || from < 0 || from >= entries.length) return [...entries];
  const next = [...entries];
  const [moved] = next.splice(from, 1);
  next.splice(Math.min(Math.max(to, 0), next.length), 0, moved!);
  return next;
}

/**
 * Expand a plan written the compact way — one line per skill, at its target
 * level — into the queue this editor works in: a row per level, each missing
 * one inserted directly ahead of the line that asked for it, so the author's
 * order is preserved. Exact duplicates collapse. Lines with no known skill are
 * passed through untouched.
 */
export function expandLevels(entries: readonly PlanDraftEntry[]): PlanDraftEntry[] {
  const out: PlanDraftEntry[] = [];
  for (const entry of entries) {
    if (entry.skillTypeId === null) {
      if (!out.some((seen) => entryKey(seen) === entryKey(entry))) out.push(entry);
      continue;
    }
    for (let level = planLevel(out, entry.skillTypeId) + 1; level <= entry.level; level += 1) {
      out.push({ ...entry, level });
    }
  }
  return out;
}

/**
 * Whether an entry is ready to be emitted: every prerequisite still waiting in
 * `remaining` has to go first, as does a lower level of the entry's own skill.
 * A prerequisite that is nowhere in the plan doesn't block anything — it's
 * reported by `draftIssues`, not fixed by reordering.
 */
function isReady(
  entry: PlanDraftEntry,
  remaining: readonly PlanDraftEntry[],
  skills: SkillMap,
): boolean {
  if (entry.skillTypeId === null) return true;
  const self = entry.skillTypeId;
  const blockedByOwnLevel = remaining.some(
    (other) => other !== entry && other.skillTypeId === self && other.level < entry.level,
  );
  if (blockedByOwnLevel) return false;

  return (skills.get(self)?.prereqs ?? []).every(
    (prereq) => planLevel(remaining, prereq.skillTypeId) < prereq.level,
  );
}

/**
 * Reorder a draft into training order: every prerequisite ahead of the skill
 * that needs it, lower levels ahead of higher ones. Stable — a row only moves
 * when something it depends on sits behind it — so a hand-arranged order
 * survives the pass unchanged.
 */
export function sortByPrereqs(
  entries: readonly PlanDraftEntry[],
  skills: SkillMap,
): PlanDraftEntry[] {
  const remaining = [...entries];
  const ordered: PlanDraftEntry[] = [];

  while (remaining.length > 0) {
    const index = remaining.findIndex((entry) => isReady(entry, remaining, skills));
    // Nothing ready means a dependency cycle; take the head so this terminates.
    const [entry] = remaining.splice(index === -1 ? 0 : index, 1);
    ordered.push(entry!);
  }
  return ordered;
}

export type DraftIssueKind = 'order' | 'redundant' | 'missing-prereq' | 'unknown-skill';

export interface DraftIssue {
  kind: DraftIssueKind;
  message: string;
}

/** Short chip label per issue kind, for the row that carries it. */
export const ISSUE_LABEL: Record<DraftIssueKind, string> = {
  order: 'order',
  redundant: 'covered',
  'missing-prereq': 'prereq',
  'unknown-skill': 'unknown',
};

/** What a row depends on: its skill's prerequisites, plus its own level below. */
function requirementsOf(
  entry: PlanDraftEntry & { skillTypeId: number },
  skills: SkillMap,
): DraftRequirement[] {
  return [
    ...(skills.get(entry.skillTypeId)?.prereqs ?? []),
    ...(entry.level > 1 ? [{ skillTypeId: entry.skillTypeId, level: entry.level - 1 }] : []),
  ];
}

/**
 * What's worth telling the user about each row, worst first: something it needs
 * queued *after* it (this plan won't train in this order), a level an earlier
 * row already covers, a prerequisite the plan never trains (fine when the
 * character already has it — a note, not an error), or a name no SDE skill
 * matched.
 */
export function draftIssues(
  entries: readonly PlanDraftEntry[],
  skills: SkillMap,
): Map<string, DraftIssue> {
  const issues = new Map<string, DraftIssue>();

  entries.forEach((entry, index) => {
    const key = entryKey(entry);
    if (entry.skillTypeId === null) {
      issues.set(key, {
        kind: 'unknown-skill',
        message: 'No matching skill in the static data — kept exactly as written.',
      });
      return;
    }

    const withId = entry as PlanDraftEntry & { skillTypeId: number };
    const before = entries.slice(0, index);
    const after = entries.slice(index + 1);
    const required = requirementsOf(withId, skills);

    const late = required.find(
      (prereq) =>
        planLevel(before, prereq.skillTypeId) < prereq.level &&
        planLevel(after, prereq.skillTypeId) >= prereq.level,
    );
    if (late) {
      issues.set(key, {
        kind: 'order',
        message: `Queued before ${skillName(skills, late.skillTypeId)} ${romanLevel(late.level)}, which it needs first.`,
      });
      return;
    }

    const covered = planLevel(before, entry.skillTypeId);
    if (covered >= entry.level) {
      issues.set(key, {
        kind: 'redundant',
        message: `Trains nothing — an earlier row already takes this skill to ${romanLevel(covered)}.`,
      });
      return;
    }

    const missing = required.find(
      (prereq) => planLevel(entries, prereq.skillTypeId) < prereq.level,
    );
    if (missing) {
      issues.set(key, {
        kind: 'missing-prereq',
        message: `Needs ${skillName(skills, missing.skillTypeId)} ${romanLevel(missing.level)}, which this plan doesn't train.`,
      });
    }
  });

  return issues;
}

/**
 * SP each row adds, in order. A row only costs the step from the level an
 * earlier row already reached, so a queue that walks a skill I→V totals exactly
 * what training it to V costs. Null when the skill's data is missing (static
 * data not imported, or an unrecognised name).
 */
export function entrySpCosts(
  entries: readonly PlanDraftEntry[],
  skills: SkillMap,
): Array<number | null> {
  return entries.map((entry, index) => {
    if (entry.skillTypeId === null) return null;
    const spAtLevel = skills.get(entry.skillTypeId)?.spAtLevel;
    if (!spAtLevel) return null;

    const target = spAtLevel[entry.level - 1];
    if (target === undefined) return null;

    const already = planLevel(entries.slice(0, index), entry.skillTypeId);
    const from = already > 0 ? (spAtLevel[already - 1] ?? 0) : 0;
    return Math.max(0, target - from);
  });
}

/**
 * Minutes each row takes at the given attributes — the SP it adds divided by
 * that skill's own training speed. Null where the SP or the skill's attributes
 * are unknown, so a missing figure never reads as "free".
 */
export function entryTimeCosts(
  entries: readonly PlanDraftEntry[],
  skills: SkillMap,
  attributes: NeuralAttributes,
): Array<number | null> {
  return entrySpCosts(entries, skills).map((sp, index) => {
    if (sp === null) return null;
    const skill = skills.get(entries[index]!.skillTypeId!);
    if (!skill?.primaryAttribute || !skill.secondaryAttribute) return null;
    const rate = spPerMinute(attributes, {
      primary: skill.primaryAttribute,
      secondary: skill.secondaryAttribute,
    });
    if (!Number.isFinite(rate) || rate <= 0) return null;
    return sp / rate;
  });
}

export interface DraftTotals {
  /** SP the whole draft costs from zero. */
  sp: number;
  /** Minutes to train it at the given attributes. */
  minutes: number;
  /** Rows whose cost is unknown, so the totals are a floor rather than the figure. */
  unknown: number;
}

export function draftTotals(
  entries: readonly PlanDraftEntry[],
  skills: SkillMap,
  attributes: NeuralAttributes,
): DraftTotals {
  const sp = entrySpCosts(entries, skills);
  const time = entryTimeCosts(entries, skills, attributes);

  let totalSp = 0;
  let minutes = 0;
  let unknown = 0;
  sp.forEach((cost, index) => {
    if (cost === null) unknown += 1;
    else totalSp += cost;
    const spent = time[index];
    if (spent !== null && spent !== undefined) minutes += spent;
  });
  return { sp: totalSp, minutes, unknown };
}

/**
 * SP the draft spends on each attribute pair — the whole objective the
 * optimiser needs, collapsed from hundreds of rows to at most a handful of
 * buckets. Rows with no SP or no attribute data contribute nothing.
 */
function spByAttributePair(
  entries: readonly PlanDraftEntry[],
  skills: SkillMap,
): Array<{ primary: TrainingAttribute; secondary: TrainingAttribute; sp: number }> {
  const costs = entrySpCosts(entries, skills);
  const byPair = new Map<string, { primary: TrainingAttribute; secondary: TrainingAttribute; sp: number }>();

  entries.forEach((entry, index) => {
    const sp = costs[index];
    if (entry.skillTypeId === null || sp === null || sp === undefined) return;
    const skill = skills.get(entry.skillTypeId);
    if (!skill?.primaryAttribute || !skill.secondaryAttribute) return;

    const key = `${skill.primaryAttribute}/${skill.secondaryAttribute}`;
    const bucket = byPair.get(key);
    if (bucket) bucket.sp += sp;
    else byPair.set(key, { primary: skill.primaryAttribute, secondary: skill.secondaryAttribute, sp });
  });

  return [...byPair.values()];
}

/** Minutes a whole draft takes at one attribute set, from the pair buckets. */
function minutesFor(
  buckets: ReturnType<typeof spByAttributePair>,
  attributes: NeuralAttributes,
): number {
  let minutes = 0;
  for (const bucket of buckets) {
    const rate = spPerMinute(attributes, { primary: bucket.primary, secondary: bucket.secondary });
    if (rate > 0) minutes += bucket.sp / rate;
  }
  return minutes;
}

/** How far one attribute set sits from another — the tie-break, so a tie doesn't reshuffle. */
function attributeDistance(a: NeuralAttributes, b: NeuralAttributes): number {
  return TRAINING_ATTRIBUTES.reduce((sum, attribute) => sum + Math.abs(a[attribute] - b[attribute]), 0);
}

/**
 * The fastest way to arrange the attributes the user has already committed to.
 *
 * The total is kept, not raised: whatever it is now — an even remap, or one
 * with implants on top — the optimiser only rearranges it, inside the window
 * that total implies (`remapWindow`: EVE's 17–27 remap range, slid up by
 * whatever the total says the implants are worth). So it answers "what is the
 * best remap for this plan?", not "what if you had better implants?".
 *
 * Every legal arrangement is tried rather than approximated: the window is 11
 * values wide, and the plan collapses to a handful of attribute-pair buckets,
 * so the exact answer costs less than a frame. Ties keep the arrangement
 * closest to the current one, and a plan with nothing to price is left alone.
 */
export function optimizeAttributes(
  entries: readonly PlanDraftEntry[],
  skills: SkillMap,
  current: NeuralAttributes,
): NeuralAttributes {
  const buckets = spByAttributePair(entries, skills);
  if (buckets.length === 0) return current;

  const total = TRAINING_ATTRIBUTES.reduce((sum, attribute) => sum + current[attribute], 0);
  const { low: windowLow, high: windowHigh } = remapWindow(total);

  const values: number[] = [];
  let best: NeuralAttributes | null = null;
  let bestMinutes = Number.POSITIVE_INFINITY;

  const consider = (candidate: NeuralAttributes): void => {
    const minutes = minutesFor(buckets, candidate);
    if (minutes > bestMinutes) return;
    if (
      minutes < bestMinutes ||
      best === null ||
      attributeDistance(candidate, current) < attributeDistance(best, current)
    ) {
      best = candidate;
      bestMinutes = minutes;
    }
  };

  const walk = (index: number, remaining: number): void => {
    const left = TRAINING_ATTRIBUTES.length - index;
    if (left === 0) {
      if (remaining !== 0) return;
      consider(
        Object.fromEntries(
          TRAINING_ATTRIBUTES.map((attribute, i) => [attribute, values[i]!]),
        ) as unknown as NeuralAttributes,
      );
      return;
    }

    // Only values the attributes after this one can still complete.
    const low = Math.max(windowLow, remaining - (left - 1) * windowHigh);
    const high = Math.min(windowHigh, remaining - (left - 1) * windowLow);

    for (let value = low; value <= high; value += 1) {
      values[index] = value;
      walk(index + 1, remaining - value);
    }
    values.length = index;
  };

  walk(0, total);
  return best ?? current;
}

/** A skill group as the browser lists it: its skills and the pair most of them train. */
export interface SkillGroup {
  groupId: number;
  name: string;
  /** The attribute pair the group's skills mostly use; null if it has none. */
  primaryAttribute: PlanSkillInfo['primaryAttribute'];
  secondaryAttribute: PlanSkillInfo['secondaryAttribute'];
  skills: PlanSkillInfo[];
}

/** Whether a skill trains against something other than its group's usual pair. */
export function breaksGroupStandard(group: SkillGroup, skill: PlanSkillInfo): boolean {
  return (
    skill.primaryAttribute !== group.primaryAttribute ||
    skill.secondaryAttribute !== group.secondaryAttribute
  );
}

/**
 * The catalogue as the browser shows it: published skills bucketed by their SDE
 * group, alphabetical, each group carrying the attribute pair the majority of
 * its skills train against — so the pair is stated once per group and only
 * repeated on the skills that break it.
 */
export function groupSkills(catalog: readonly PlanSkillInfo[]): SkillGroup[] {
  const byGroup = new Map<number, PlanSkillInfo[]>();
  for (const skill of catalog) {
    if (!skill.published || skill.groupId === null) continue;
    const list = byGroup.get(skill.groupId) ?? [];
    list.push(skill);
    byGroup.set(skill.groupId, list);
  }

  const groups: SkillGroup[] = [];
  for (const [groupId, skills] of byGroup) {
    const tally = new Map<string, number>();
    for (const skill of skills) {
      if (!skill.primaryAttribute || !skill.secondaryAttribute) continue;
      const pair = `${skill.primaryAttribute}/${skill.secondaryAttribute}`;
      tally.set(pair, (tally.get(pair) ?? 0) + 1);
    }
    // Ties break alphabetically so the standard pair never depends on row order.
    const standard = [...tally.entries()].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    )[0];
    const [primary, secondary] = standard ? standard[0].split('/') : [null, null];

    groups.push({
      groupId,
      name: skills[0]!.groupName ?? `Group ${groupId}`,
      primaryAttribute: (primary as PlanSkillInfo['primaryAttribute']) ?? null,
      secondaryAttribute: (secondary as PlanSkillInfo['secondaryAttribute']) ?? null,
      skills: [...skills].sort((a, b) => a.name.localeCompare(b.name)),
    });
  }
  return groups.sort((a, b) => a.name.localeCompare(b.name));
}

/** Groups (and within them, skills) whose name matches a filter; empty query = everything. */
export function filterGroups(groups: readonly SkillGroup[], query: string): SkillGroup[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return [...groups];

  const matches: SkillGroup[] = [];
  for (const group of groups) {
    if (group.name.toLowerCase().includes(needle)) {
      matches.push(group);
      continue;
    }
    const skills = group.skills.filter((skill) => skill.name.toLowerCase().includes(needle));
    if (skills.length > 0) matches.push({ ...group, skills });
  }
  return matches;
}

/**
 * The draft as plan text: one `Skill Name V` line per row. This is both what
 * MCO stores (see `main/plans/parse.ts`) and what EVE's own "import skill plan
 * from clipboard" accepts, so one rendering serves saving and exporting.
 */
export function draftText(entries: readonly PlanDraftEntry[]): string {
  return entries.map((entry) => `${entry.skillName} ${romanLevel(entry.level)}`).join('\n');
}
