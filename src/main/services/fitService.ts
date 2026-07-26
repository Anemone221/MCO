import type { Fit, FitAnalysis, FitItemResolved, GroupObjectiveStatus } from '@shared/types';
import { countsForSkills, parseEft } from '../fits/eft';
import {
  analyzeFit,
  buildSkillPrereqMap,
  objectiveProgress,
  type AnalysisCharacter,
  type SkillRequirement,
} from '../fits/analyze';
import { createFit, getFit } from '../db/repositories/fits';
import {
  getCategoryForTypes,
  getSdeStatus,
  getSkillRanks,
  getSkillReqsForTypes,
  getTypeNames,
  resolveTypeIdsByName,
} from '../db/repositories/sde';
import { listCharacters } from '../db/repositories/characters';
import { getCharacterSkillMap } from '../db/repositories/skills';
import { getNeuralAttributes, getSkillTrainingAttributes } from './trainingData';

/** Parse an EFT fit, resolve its hull, and persist it. */
export function importFit(eftText: string): Fit {
  const parsed = parseEft(eftText);
  const { resolved } = resolveTypeIdsByName([parsed.shipName]);
  return createFit({
    name: parsed.fitName,
    shipName: parsed.shipName,
    shipTypeId: resolved.get(parsed.shipName) ?? null,
    eftText,
  });
}

interface ResolvedFit {
  shipTypeId: number | null;
  items: FitItemResolved[];
  unresolved: string[];
}

/** Parse a stored fit and resolve every item, flagging which ones count for skills. */
function resolveFit(fit: Fit): ResolvedFit {
  const parsed = parseEft(fit.eftText);
  const { resolved } = resolveTypeIdsByName([
    parsed.shipName,
    ...parsed.items.map((i) => i.name),
  ]);
  const shipTypeId = resolved.get(parsed.shipName) ?? null;

  // Categories of the `xN` items distinguish drones/spares (counted) from inert cargo (not).
  const quantityTypeIds = parsed.items
    .filter((i) => i.kind === 'quantity')
    .map((i) => resolved.get(i.name))
    .filter((id): id is number => id !== undefined);
  const categories = getCategoryForTypes(quantityTypeIds);

  const items: FitItemResolved[] = parsed.items.map((item) => {
    const typeId = resolved.get(item.name) ?? null;
    const counted = typeId !== null && countsForSkills(item.kind, categories.get(typeId));
    return { name: item.name, typeId, quantity: item.quantity, counted };
  });

  const unresolved = [
    ...(shipTypeId === null ? [parsed.shipName] : []),
    ...items.filter((i) => i.typeId === null).map((i) => i.name),
  ];

  return { shipTypeId, items, unresolved };
}

/** Direct skill requirements of a resolved fit's counted types (hull + fitted items). */
function fitDirectReqs({ shipTypeId, items }: ResolvedFit): SkillRequirement[] {
  const countedTypeIds = [
    ...(shipTypeId !== null ? [shipTypeId] : []),
    ...items.filter((i) => i.counted && i.typeId !== null).map((i) => i.typeId as number),
  ];
  return getSkillReqsForTypes([...new Set(countedTypeIds)]).map((r) => ({
    skillTypeId: r.skillTypeId,
    level: r.level,
  }));
}

/** Analyse a stored fit across the whole character roster. */
export function analyzeFitById(fitId: number): FitAnalysis {
  const fit = getFit(fitId);
  if (!fit) throw new Error(`Unknown fit ${fitId}`);

  const resolvedFit = resolveFit(fit);
  const { shipTypeId, items, unresolved } = resolvedFit;

  const sde = getSdeStatus();
  if (!sde.hasSkillData) {
    return {
      fit,
      shipResolved: shipTypeId !== null,
      items,
      unresolved,
      needsSkillData: true,
      needsSkillAttributes: !sde.hasSkillAttributes,
      characters: [],
    };
  }

  const directReqs = fitDirectReqs(resolvedFit);

  const { skillPrereqs, allSkillIds } = buildSkillPrereqMap(
    directReqs.map((r) => r.skillTypeId),
    getSkillReqsForTypes,
  );

  const characters: AnalysisCharacter[] = listCharacters().map((c) => ({
    characterId: c.id,
    characterName: c.name,
    skills: getCharacterSkillMap(c.id),
    attributes: getNeuralAttributes(c.id),
  }));

  const results = analyzeFit({
    directReqs,
    skillPrereqs,
    ranks: getSkillRanks(allSkillIds),
    skillNames: getTypeNames(allSkillIds),
    skillAttributes: getSkillTrainingAttributes(allSkillIds),
    characters,
  });

  return {
    fit,
    shipResolved: shipTypeId !== null,
    items,
    unresolved,
    needsSkillData: false,
    needsSkillAttributes: !sde.hasSkillAttributes,
    characters: results,
  };
}

/**
 * Skill status toward a fit for a specific character set, computed in one
 * analysis pass. A phantom zero-skill character yields the fit's from-zero SP
 * cost so each result carries a 0..1 progress share. Returns null when the
 * fit is gone or SDE skill data isn't imported.
 */
export function fitObjectiveStatus(
  fitId: number,
  characterIds: number[],
): Map<number, GroupObjectiveStatus> | null {
  const fit = getFit(fitId);
  if (!fit || !getSdeStatus().hasSkillData) return null;

  const directReqs = fitDirectReqs(resolveFit(fit));
  const { skillPrereqs, allSkillIds } = buildSkillPrereqMap(
    directReqs.map((r) => r.skillTypeId),
    getSkillReqsForTypes,
  );

  const characters: AnalysisCharacter[] = [
    { characterId: -1, characterName: '', skills: new Map() },
    ...characterIds.map((id) => ({
      characterId: id,
      characterName: '',
      skills: getCharacterSkillMap(id),
      attributes: getNeuralAttributes(id),
    })),
  ];

  const [zero, ...results] = analyzeFit({
    directReqs,
    skillPrereqs,
    ranks: getSkillRanks(allSkillIds),
    skillNames: getTypeNames(allSkillIds),
    skillAttributes: getSkillTrainingAttributes(allSkillIds),
    characters,
  });

  const totalSp = zero!.spGap;
  const statuses = new Map<number, GroupObjectiveStatus>();
  for (const r of results) {
    statuses.set(r.characterId, {
      complete: r.canFly,
      spGap: r.spGap,
      totalSp,
      progress: objectiveProgress(r.spGap, totalSp),
      lsiGap: r.lsiGap,
      timeGapMinutes: r.timeGapMinutes,
      missingSkillCount: r.missingSkills.length,
    });
  }
  return statuses;
}
