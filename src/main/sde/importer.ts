import YAML from 'yaml';
import {
  replaceBlueprints,
  replaceCategories,
  replaceGroups,
  replaceRegions,
  replaceSkillAttributes,
  replaceSkillDescriptions,
  replaceSkillRanks,
  replaceSystemJumps,
  replaceSystems,
  replaceTypeSkillReqs,
  replaceTypes,
  setSdeVersion,
  type SdeGroupRow,
  type SdeTypeRow,
} from '../db/repositories/sde';
import {
  decodeDescription,
  parseBlueprints,
  parseNamedFile,
  parseSolarSystems,
  parseStargates,
  parseTypeDogmaStream,
  parseTypesStream,
} from './parse';
import { bufferStream, processZip } from './zip';

export interface SdeImportProgress {
  phase: 'categories' | 'groups' | 'types' | 'dogma' | 'blueprints' | 'maps' | 'finalizing';
  typesProcessed?: number;
}

/** SDE category holding every trainable skill. */
const SKILL_CATEGORY_ID = 16;

/** Decode the descriptions of the types that are skills; the rest are dropped. */
function skillDescriptions(
  types: SdeTypeRow[],
  skillGroupIds: ReadonlySet<number>,
  sources: ReadonlyMap<number, string>,
): Array<{ skillTypeId: number; description: string }> {
  const rows: Array<{ skillTypeId: number; description: string }> = [];
  for (const type of types) {
    if (!skillGroupIds.has(type.groupId)) continue;
    const source = sources.get(type.id);
    const description = source === undefined ? null : decodeDescription(source);
    if (description !== null) rows.push({ skillTypeId: type.id, description });
  }
  return rows;
}

/** Import the SDE zip into SQLite: categories, groups, types, and the version stamp. */
export async function importSde(
  zipPath: string,
  onProgress?: (progress: SdeImportProgress) => void,
): Promise<{ version: string; typeCount: number }> {
  let version = 'unknown';
  let typeRows: SdeTypeRow[] = [];
  /** Raw English descriptions by type id; only skills' are decoded and kept. */
  let descriptionSources = new Map<number, string>();
  /** Groups in the skill category, from groups.yaml; null if it never came. */
  let skillGroupIds: Set<number> | null = null;

  await processZip(zipPath, {
    '_sde.yaml': async (stream) => {
      const parsed = YAML.parse(await bufferStream(stream)) as {
        sde?: { buildNumber?: number };
      };
      if (parsed.sde?.buildNumber !== undefined) version = String(parsed.sde.buildNumber);
    },
    'categories.yaml': async (stream) => {
      onProgress?.({ phase: 'categories' });
      replaceCategories(parseNamedFile(await bufferStream(stream)));
    },
    'groups.yaml': async (stream) => {
      onProgress?.({ phase: 'groups' });
      const rows: SdeGroupRow[] = parseNamedFile(await bufferStream(stream)).map((e) => ({
        id: e.id,
        categoryId: e.categoryId ?? 0,
        name: e.name,
        published: e.published,
      }));
      replaceGroups(rows);
      skillGroupIds = new Set(
        rows.filter((g) => g.categoryId === SKILL_CATEGORY_ID).map((g) => g.id),
      );
    },
    'types.yaml': async (stream) => {
      onProgress?.({ phase: 'types', typesProcessed: 0 });
      const parsed = await parseTypesStream(stream, (p) => {
        onProgress?.({ phase: 'types', typesProcessed: p.typesProcessed });
      });
      typeRows = parsed.map((t) => ({
        id: t.id,
        groupId: t.groupId,
        name: t.name,
        published: t.published,
        marketGroupId: t.marketGroupId,
        metaGroupId: t.metaGroupId,
        volume: t.volume,
      }));
      descriptionSources = new Map(
        parsed.flatMap((t) =>
          t.descriptionSource === null ? [] : [[t.id, t.descriptionSource] as const],
        ),
      );
    },
    'blueprints.yaml': async (stream) => {
      onProgress?.({ phase: 'blueprints' });
      replaceBlueprints(
        parseBlueprints(await bufferStream(stream)).map((b) => ({
          blueprintTypeId: b.blueprintTypeId,
          productTypeId: b.productTypeId,
          activity: b.activity,
          maxProductionLimit: b.maxProductionLimit,
        })),
      );
    },
    'typeDogma.yaml': async (stream) => {
      onProgress?.({ phase: 'dogma', typesProcessed: 0 });
      const { skillReqs, ranks, skillAttributes } = await parseTypeDogmaStream(stream, (p) => {
        onProgress?.({ phase: 'dogma', typesProcessed: p.typesProcessed });
      });
      replaceTypeSkillReqs(skillReqs);
      replaceSkillRanks(ranks.map((r) => ({ skillTypeId: r.typeId, rank: r.rank })));
      replaceSkillAttributes(
        skillAttributes.map((a) => ({
          skillTypeId: a.typeId,
          primaryAttributeId: a.primaryAttributeId,
          secondaryAttributeId: a.secondaryAttributeId,
        })),
      );
    },
    'mapRegions.yaml': async (stream) => {
      onProgress?.({ phase: 'maps' });
      replaceRegions(
        parseNamedFile(await bufferStream(stream)).map((e) => ({ id: e.id, name: e.name })),
      );
    },
    'mapSolarSystems.yaml': async (stream) => {
      onProgress?.({ phase: 'maps' });
      replaceSystems(parseSolarSystems(await bufferStream(stream)));
    },
    'mapStargates.yaml': async (stream) => {
      onProgress?.({ phase: 'maps' });
      replaceSystemJumps(parseStargates(await bufferStream(stream)));
    },
  });

  onProgress?.({ phase: 'finalizing' });
  replaceTypes(typeRows);
  if (skillGroupIds !== null) {
    replaceSkillDescriptions(skillDescriptions(typeRows, skillGroupIds, descriptionSources));
  }
  setSdeVersion(version);
  return { version, typeCount: typeRows.length };
}
