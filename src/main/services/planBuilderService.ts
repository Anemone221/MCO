import type { PlanDraftEntry, PlanDraftSource, PlanSkillInfo, ShipInfo } from '@shared/types';
import { spForLevel } from '../fits/analyze';
import { trainingAttributesFromIds } from '../fits/cost';
import {
  getSkillAttributes,
  getSkillCatalog,
  getShipCatalog,
  getSkillReqsForTypes,
  getSkillTypes,
  resolveSkillIdsByName,
  type SkillTypeRow,
} from '../db/repositories/sde';
import { getFit } from '../db/repositories/fits';
import { getPlan } from '../db/repositories/plans';
import { parseEft } from '../fits/eft';
import { parseSkillPlan } from '../plans/parse';
import { eftSkillRequirements } from './fitService';
import { UserFacingError } from '../errors';

const LEVELS = [1, 2, 3, 4, 5];

/**
 * Every skill in the game, with the group, rank, training attributes, per-level
 * SP and prerequisites the creator needs.
 *
 * Handed over in one payload (~600 skills) rather than queried per interaction:
 * with the whole catalogue in the renderer, filtering the browser, adding a
 * skill with its prerequisites, reordering and re-costing a draft are all local.
 */
export function skillCatalog(): PlanSkillInfo[] {
  const skills = getSkillCatalog();
  return decorate(skills);
}

/** Turn skill rows into catalogue entries, attaching attributes and prereqs. */
function decorate(skills: SkillTypeRow[]): PlanSkillInfo[] {
  const ids = skills.map((skill) => skill.skillTypeId);
  const attributes = getSkillAttributes(ids);

  const prereqs = new Map<number, Array<{ skillTypeId: number; level: number }>>();
  for (const row of getSkillReqsForTypes(ids)) {
    const list = prereqs.get(row.typeId) ?? [];
    list.push({ skillTypeId: row.skillTypeId, level: row.level });
    prereqs.set(row.typeId, list);
  }

  return skills.map((skill) => {
    const attrs = attributes.get(skill.skillTypeId);
    const training = attrs
      ? trainingAttributesFromIds(attrs.primaryAttributeId, attrs.secondaryAttributeId)
      : null;
    return {
      skillTypeId: skill.skillTypeId,
      name: skill.name,
      groupId: skill.groupId,
      groupName: skill.groupName,
      rank: skill.rank,
      primaryAttribute: training?.primary ?? null,
      secondaryAttribute: training?.secondary ?? null,
      spAtLevel: LEVELS.map((level) => spForLevel(skill.rank, level)),
      prereqs: prereqs.get(skill.skillTypeId) ?? [],
      published: skill.published,
    };
  });
}

/**
 * Every hull with the skills flying it needs, for the ship browser. The
 * requirements ride along (~700 rows across 415 ships) so choosing a ship is
 * answered entirely in the renderer.
 */
export function shipCatalog(): ShipInfo[] {
  const ships = getShipCatalog();

  const requirements = new Map<number, Array<{ skillTypeId: number; level: number }>>();
  for (const row of getSkillReqsForTypes(ships.map((ship) => ship.shipTypeId))) {
    const list = requirements.get(row.typeId) ?? [];
    list.push({ skillTypeId: row.skillTypeId, level: row.level });
    requirements.set(row.typeId, list);
  }

  return ships.map((ship) => ({
    ...ship,
    requirements: requirements.get(ship.shipTypeId) ?? [],
  }));
}

/**
 * A stored plan opened for editing: its lines in their written order, so the
 * order the user chose survives the round trip. Lines naming something the SDE
 * has no skill for are kept as id-less entries rather than dropped — saving the
 * plan again must not quietly delete them.
 */
export function planDraft(planId: number): PlanDraftSource {
  const plan = getPlan(planId);
  if (!plan) throw new UserFacingError('That skill plan no longer exists.');

  const parsed = parseSkillPlan(plan.planText);
  const { resolved, unresolved } = resolveSkillIdsByName(parsed.map((e) => e.skillName));
  const entries: PlanDraftEntry[] = parsed.map((entry) => ({
    skillTypeId: resolved.get(entry.skillName) ?? null,
    skillName: entry.skillName,
    level: entry.level,
  }));
  return { entries, unresolved, suggestedName: plan.name };
}

/**
 * The skills an EFT block calls for, as draft entries. Only the fit's *direct*
 * requirements are listed — the creator fills in prerequisites and the levels
 * below each one, which is also what puts them in trainable order.
 */
export function eftDraft(eftText: string, name?: string | null): PlanDraftSource {
  const { requirements, unresolved } = eftSkillRequirements(eftText);

  const highestLevel = new Map<number, number>();
  for (const req of requirements) {
    highestLevel.set(req.skillTypeId, Math.max(highestLevel.get(req.skillTypeId) ?? 0, req.level));
  }

  const names = new Map(
    getSkillTypes([...highestLevel.keys()]).map((skill) => [skill.skillTypeId, skill.name]),
  );
  const entries: PlanDraftEntry[] = [...highestLevel]
    .map(([skillTypeId, level]) => ({
      skillTypeId,
      skillName: names.get(skillTypeId) ?? `Skill ${skillTypeId}`,
      level,
    }))
    .sort((a, b) => a.skillName.localeCompare(b.skillName));

  return { entries, unresolved, suggestedName: name ?? parseEft(eftText).fitName };
}

/** The skills a stored fit calls for. */
export function fitDraft(fitId: number): PlanDraftSource {
  const fit = getFit(fitId);
  if (!fit) throw new UserFacingError('That fit no longer exists.');
  return eftDraft(fit.eftText, fit.name);
}
