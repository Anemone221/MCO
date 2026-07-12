import type { Fit, FitAnalysis, FitItemResolved } from '@shared/types';
import { parseEft } from '../fits/eft';
import {
  analyzeFit,
  buildSkillPrereqMap,
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

/** SDE category id for the "Drone" item category. */
const DRONE_CATEGORY_ID = 18;

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

/** Analyse a stored fit across the whole character roster. */
export function analyzeFitById(fitId: number): FitAnalysis {
  const fit = getFit(fitId);
  if (!fit) throw new Error(`Unknown fit ${fitId}`);

  const parsed = parseEft(fit.eftText);
  const { resolved } = resolveTypeIdsByName([
    parsed.shipName,
    ...parsed.items.map((i) => i.name),
  ]);
  const shipTypeId = resolved.get(parsed.shipName) ?? null;

  // Categories of the `xN` items distinguish drones (counted) from cargo (not).
  const quantityTypeIds = parsed.items
    .filter((i) => i.kind === 'quantity')
    .map((i) => resolved.get(i.name))
    .filter((id): id is number => id !== undefined);
  const categories = getCategoryForTypes(quantityTypeIds);

  const items: FitItemResolved[] = parsed.items.map((item) => {
    const typeId = resolved.get(item.name) ?? null;
    const counted =
      item.kind === 'quantity'
        ? typeId !== null && categories.get(typeId) === DRONE_CATEGORY_ID
        : typeId !== null;
    return { name: item.name, typeId, quantity: item.quantity, counted };
  });

  const unresolved = [
    ...(shipTypeId === null ? [parsed.shipName] : []),
    ...items.filter((i) => i.typeId === null).map((i) => i.name),
  ];

  if (!getSdeStatus().hasSkillData) {
    return {
      fit,
      shipResolved: shipTypeId !== null,
      items,
      unresolved,
      needsSkillData: true,
      characters: [],
    };
  }

  const countedTypeIds = [
    ...(shipTypeId !== null ? [shipTypeId] : []),
    ...items.filter((i) => i.counted && i.typeId !== null).map((i) => i.typeId as number),
  ];

  const directReqs: SkillRequirement[] = getSkillReqsForTypes([
    ...new Set(countedTypeIds),
  ]).map((r) => ({ skillTypeId: r.skillTypeId, level: r.level }));

  const { skillPrereqs, allSkillIds } = buildSkillPrereqMap(
    directReqs.map((r) => r.skillTypeId),
    getSkillReqsForTypes,
  );

  const characters: AnalysisCharacter[] = listCharacters().map((c) => ({
    characterId: c.id,
    characterName: c.name,
    skills: getCharacterSkillMap(c.id),
  }));

  const results = analyzeFit({
    directReqs,
    skillPrereqs,
    ranks: getSkillRanks(allSkillIds),
    skillNames: getTypeNames(allSkillIds),
    characters,
  });

  return {
    fit,
    shipResolved: shipTypeId !== null,
    items,
    unresolved,
    needsSkillData: false,
    characters: results,
  };
}
