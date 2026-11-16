import YAML from 'yaml';
import {
  inSdeTransaction,
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

/**
 * Import the SDE zip into SQLite: categories, groups, types, dogma, blueprints,
 * the map, and the version stamp.
 *
 * In two phases. The zip is read and parsed first, with nothing written; each
 * file's handler only queues the write it would make. Then every queued write
 * and the version stamp run in a single transaction. An import that fails at
 * any point — a corrupt zip, a file CCP reshaped, a full disk, the app closed
 * halfway — therefore leaves the previous build exactly as it was, rather than
 * one build's groups beside another's types and skill requirements, which fit
 * and plan analysis would go on to read without any error.
 *
 * A file missing from the zip queues nothing, so its table keeps what it had.
 */
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
  const startedAt = Date.now();
  /** The table writes, in zip order, held back until everything has parsed. */
  const writes: Array<() => void> = [];

  await processZip(zipPath, {
    '_sde.yaml': async (stream) => {
      const parsed = YAML.parse(await bufferStream(stream)) as {
        sde?: { buildNumber?: number };
      };
      if (parsed.sde?.buildNumber !== undefined) version = String(parsed.sde.buildNumber);
    },
    'categories.yaml': async (stream) => {
      onProgress?.({ phase: 'categories' });
      const rows = parseNamedFile(await bufferStream(stream));
      writes.push(() => replaceCategories(rows));
    },
    'groups.yaml': async (stream) => {
      onProgress?.({ phase: 'groups' });
      const rows: SdeGroupRow[] = parseNamedFile(await bufferStream(stream)).map((e) => ({
        id: e.id,
        categoryId: e.categoryId ?? 0,
        name: e.name,
        published: e.published,
      }));
      writes.push(() => replaceGroups(rows));
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
      const rows = parseBlueprints(await bufferStream(stream)).map((b) => ({
        blueprintTypeId: b.blueprintTypeId,
        productTypeId: b.productTypeId,
        activity: b.activity,
        maxProductionLimit: b.maxProductionLimit,
      }));
      writes.push(() => replaceBlueprints(rows));
    },
    'typeDogma.yaml': async (stream) => {
      onProgress?.({ phase: 'dogma', typesProcessed: 0 });
      const { skillReqs, ranks, skillAttributes } = await parseTypeDogmaStream(stream, (p) => {
        onProgress?.({ phase: 'dogma', typesProcessed: p.typesProcessed });
      });
      writes.push(() => {
        replaceTypeSkillReqs(skillReqs);
        replaceSkillRanks(ranks.map((r) => ({ skillTypeId: r.typeId, rank: r.rank })));
        replaceSkillAttributes(
          skillAttributes.map((a) => ({
            skillTypeId: a.typeId,
            primaryAttributeId: a.primaryAttributeId,
            secondaryAttributeId: a.secondaryAttributeId,
          })),
        );
      });
    },
    'mapRegions.yaml': async (stream) => {
      onProgress?.({ phase: 'maps' });
      const rows = parseNamedFile(await bufferStream(stream)).map((e) => ({
        id: e.id,
        name: e.name,
      }));
      writes.push(() => replaceRegions(rows));
    },
    'mapSolarSystems.yaml': async (stream) => {
      onProgress?.({ phase: 'maps' });
      const rows = parseSolarSystems(await bufferStream(stream));
      writes.push(() => replaceSystems(rows));
    },
    'mapStargates.yaml': async (stream) => {
      onProgress?.({ phase: 'maps' });
      const rows = parseStargates(await bufferStream(stream));
      writes.push(() => replaceSystemJumps(rows));
    },
  });

  const parsedAt = Date.now();
  onProgress?.({ phase: 'finalizing' });
  // The write below is synchronous and holds the main process for its whole
  // length, and a progress event is only *queued* by the call above. Without a
  // turn of the event loop here it would reach the window after the write, not
  // before it — the UI would sit on the last parse step until the very end.
  await new Promise((resolve) => setTimeout(resolve, 50));
  // Narrowed here: the assignment happens inside a handler, which the compiler
  // cannot see from this side of the await.
  const skillGroups = skillGroupIds as Set<number> | null;
  inSdeTransaction(() => {
    for (const write of writes) write();
    replaceTypes(typeRows);
    if (skillGroups !== null) {
      replaceSkillDescriptions(skillDescriptions(typeRows, skillGroups, descriptionSources));
    }
    // Last, and inside the transaction: the stamp can no longer name a build
    // whose tables did not all land.
    setSdeVersion(version);
  });
  const seconds = (from: number, to: number): string => ((to - from) / 1000).toFixed(1);
  console.log(
    `[sde] imported build ${version}: ${typeRows.length} types, parsed in ` +
      `${seconds(startedAt, parsedAt)}s, written in ${seconds(parsedAt, Date.now())}s`,
  );
  return { version, typeCount: typeRows.length };
}
