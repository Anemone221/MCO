import YAML from 'yaml';
import {
  replaceBlueprints,
  replaceCategories,
  replaceGroups,
  replaceRegions,
  replaceSkillAttributes,
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

/** Import the SDE zip into SQLite: categories, groups, types, and the version stamp. */
export async function importSde(
  zipPath: string,
  onProgress?: (progress: SdeImportProgress) => void,
): Promise<{ version: string; typeCount: number }> {
  let version = 'unknown';
  let typeRows: SdeTypeRow[] = [];

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
  setSdeVersion(version);
  return { version, typeCount: typeRows.length };
}
