/**
 * Comparing two skill plans: which skills each one asks for that the other
 * doesn't, where they want the same skill at different levels, and what that
 * costs in SP each way.
 *
 * A plan is reduced to the highest level it needs of each skill, so the order
 * it was written in and how many rows it spends on a skill don't count as
 * differences. With `includePrereqs` the levels a plan implies through
 * prerequisites count too. That is what training it actually means: a plan
 * that writes "Caldari Battleship V" needs Caldari Cruiser even if it never
 * names it.
 *
 * Pure: the page passes in both plans' entries and the skill catalogue.
 */

import type { PlanDraftEntry } from '@shared/types';
import { addRequirements, entryKey, type DraftRequirement, type SkillMap } from './planDraft';

/** How a skill compares between plan A and plan B. */
export type DiffStatus = 'only-a' | 'only-b' | 'a-higher' | 'b-higher' | 'same';

export interface PlanDiffRow {
  /** Skill identity: the type id, or the lower-cased name for a skill the SDE doesn't know. */
  key: string;
  skillTypeId: number | null;
  name: string;
  groupName: string | null;
  /** Level plan A needs; 0 when A doesn't need the skill. */
  levelA: number;
  levelB: number;
  /**
   * The level the plan itself writes, before prerequisites are counted. Lower
   * than `levelA` when part of A's level comes only from a prerequisite.
   */
  writtenA: number;
  writtenB: number;
  status: DiffStatus;
  /** Total SP to hold `levelA`; 0 at level 0, null when the skill has no SP data. */
  spA: number | null;
  spB: number | null;
}

export interface PlanDiffSummary {
  onlyA: number;
  onlyB: number;
  aHigher: number;
  bHigher: number;
  same: number;
  /** SP to train plan A from nothing (skills without SP data left out). */
  totalSpA: number;
  totalSpB: number;
  /** SP a character who has finished A still needs for B. */
  spBBeyondA: number;
  /** SP a character who has finished B still needs for A. */
  spABeyondB: number;
  /** Rows whose SP could not be counted, so the totals are a floor. */
  uncosted: number;
}

export interface PlanDiff {
  rows: PlanDiffRow[];
  summary: PlanDiffSummary;
}

interface Need {
  skillTypeId: number | null;
  name: string;
  level: number;
  written: number;
}

function keyOf(skillTypeId: number | null, name: string): string {
  return skillTypeId === null ? `name:${name.toLowerCase()}` : String(skillTypeId);
}

/**
 * The highest level a plan needs of each skill. With `includePrereqs`, every
 * prerequisite of every listed level is raised to what it requires as well.
 */
export function requiredLevels(
  entries: readonly PlanDraftEntry[],
  skills: SkillMap,
  includePrereqs: boolean,
): Map<string, Need> {
  const needs = new Map<string, Need>();

  const raise = (skillTypeId: number | null, name: string, level: number, written: boolean) => {
    const key = keyOf(skillTypeId, name);
    const need = needs.get(key) ?? { skillTypeId, name, level: 0, written: 0 };
    need.level = Math.max(need.level, level);
    if (written) need.written = Math.max(need.written, level);
    needs.set(key, need);
  };

  // Each skill's prerequisites are walked once: what a skill requires doesn't
  // depend on the level it is trained to. Marking a skill walked before
  // descending also stops a bad import's cycle.
  const walked = new Set<number>();
  const walkPrereqs = (skillTypeId: number): void => {
    if (walked.has(skillTypeId)) return;
    walked.add(skillTypeId);
    for (const prereq of skills.get(skillTypeId)?.prereqs ?? []) {
      raise(prereq.skillTypeId, skillName(skills, prereq.skillTypeId), prereq.level, false);
      walkPrereqs(prereq.skillTypeId);
    }
  };

  for (const entry of entries) {
    const name =
      entry.skillTypeId === null
        ? entry.skillName
        : skillName(skills, entry.skillTypeId, entry.skillName);
    raise(entry.skillTypeId, name, entry.level, true);
    if (includePrereqs && entry.skillTypeId !== null) walkPrereqs(entry.skillTypeId);
  }
  return needs;
}

function skillName(skills: SkillMap, skillTypeId: number, fallback?: string): string {
  return skills.get(skillTypeId)?.name ?? fallback ?? `Skill ${skillTypeId}`;
}

/** Total SP to hold a level; 0 for level 0, null when the skill has no SP data. */
function spFor(skills: SkillMap, skillTypeId: number | null, level: number): number | null {
  if (level === 0) return 0;
  if (skillTypeId === null) return null;
  return skills.get(skillTypeId)?.spAtLevel[level - 1] ?? null;
}

function statusOf(levelA: number, levelB: number): DiffStatus {
  if (levelB === 0) return 'only-a';
  if (levelA === 0) return 'only-b';
  if (levelA > levelB) return 'a-higher';
  if (levelB > levelA) return 'b-higher';
  return 'same';
}

/** Order the default view reads in: A's side, then B's, then what they share. */
export const STATUS_ORDER: Record<DiffStatus, number> = {
  'only-a': 0,
  'a-higher': 1,
  'b-higher': 2,
  'only-b': 3,
  same: 4,
};

export const STATUS_LABEL: Record<DiffStatus, string> = {
  'only-a': 'Only in A',
  'only-b': 'Only in B',
  'a-higher': 'A higher',
  'b-higher': 'B higher',
  same: 'Same',
};

/** Compare two plans skill by skill. */
export function diffPlans(
  entriesA: readonly PlanDraftEntry[],
  entriesB: readonly PlanDraftEntry[],
  skills: SkillMap,
  { includePrereqs }: { includePrereqs: boolean },
): PlanDiff {
  const needsA = requiredLevels(entriesA, skills, includePrereqs);
  const needsB = requiredLevels(entriesB, skills, includePrereqs);

  const summary: PlanDiffSummary = {
    onlyA: 0,
    onlyB: 0,
    aHigher: 0,
    bHigher: 0,
    same: 0,
    totalSpA: 0,
    totalSpB: 0,
    spBBeyondA: 0,
    spABeyondB: 0,
    uncosted: 0,
  };
  const counter: Record<DiffStatus, keyof PlanDiffSummary> = {
    'only-a': 'onlyA',
    'only-b': 'onlyB',
    'a-higher': 'aHigher',
    'b-higher': 'bHigher',
    same: 'same',
  };

  const rows: PlanDiffRow[] = [];
  for (const key of new Set([...needsA.keys(), ...needsB.keys()])) {
    const a = needsA.get(key);
    const b = needsB.get(key);
    const ref = (a ?? b)!;
    const levelA = a?.level ?? 0;
    const levelB = b?.level ?? 0;
    const status = statusOf(levelA, levelB);
    const spA = spFor(skills, ref.skillTypeId, levelA);
    const spB = spFor(skills, ref.skillTypeId, levelB);

    summary[counter[status]] += 1;
    if (spA === null || spB === null) {
      summary.uncosted += 1;
    } else {
      summary.totalSpA += spA;
      summary.totalSpB += spB;
      summary.spBBeyondA += Math.max(0, spB - spA);
      summary.spABeyondB += Math.max(0, spA - spB);
    }

    rows.push({
      key,
      skillTypeId: ref.skillTypeId,
      name: ref.name,
      groupName: ref.skillTypeId === null ? null : (skills.get(ref.skillTypeId)?.groupName ?? null),
      levelA,
      levelB,
      writtenA: a?.written ?? 0,
      writtenB: b?.written ?? 0,
      status,
      spA,
      spB,
    });
  }

  rows.sort(
    (x, y) =>
      STATUS_ORDER[x.status] - STATUS_ORDER[y.status] ||
      (x.groupName ?? '').localeCompare(y.groupName ?? '') ||
      x.name.localeCompare(y.name),
  );
  return { rows, summary };
}

/**
 * The training queue that takes a character who has finished `from` to having
 * finished `to` as well: every level `to` needs beyond `from`, prerequisites
 * included, in an order EVE accepts. Skills the SDE doesn't know can't be
 * ordered, so they go at the end. The result renders with `draftText`, so it
 * can be imported as a plan or pasted into EVE.
 */
export function planDelta(
  from: readonly PlanDraftEntry[],
  to: readonly PlanDraftEntry[],
  skills: SkillMap,
): PlanDraftEntry[] {
  const known = (entries: readonly PlanDraftEntry[]): DraftRequirement[] =>
    entries
      .filter((e): e is PlanDraftEntry & { skillTypeId: number } => e.skillTypeId !== null)
      .map((e) => ({ skillTypeId: e.skillTypeId, level: e.level }));

  const base = addRequirements([], known(from), skills);
  const delta = addRequirements(base, known(to), skills).slice(base.length);

  const fromNamed = new Set(from.filter((e) => e.skillTypeId === null).map(entryKey));
  const seen = new Set<string>();
  for (const entry of to) {
    if (entry.skillTypeId !== null) continue;
    const key = entryKey(entry);
    if (fromNamed.has(key) || seen.has(key)) continue;
    seen.add(key);
    delta.push({ skillTypeId: null, skillName: entry.skillName, level: entry.level });
  }
  return delta;
}
