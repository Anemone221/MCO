import type { Readable } from 'node:stream';
import yauzl from 'yauzl';
import YAML from 'yaml';
import {
  replaceCategories,
  replaceGroups,
  replaceRegions,
  replaceSkillAttributes,
  replaceSkillRanks,
  replaceSystems,
  replaceTypeSkillReqs,
  replaceTypes,
  setSdeVersion,
  type SdeGroupRow,
  type SdeTypeRow,
} from '../db/repositories/sde';
import {
  parseNamedFile,
  parseSolarSystems,
  parseTypeDogmaStream,
  parseTypesStream,
} from './parse';

export interface SdeImportProgress {
  phase: 'categories' | 'groups' | 'types' | 'dogma' | 'maps' | 'finalizing';
  typesProcessed?: number;
}

type EntryHandler = (stream: Readable) => Promise<void>;

async function bufferStream(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function processZip(zipPath: string, handlers: Record<string, EntryHandler>): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err ?? new Error('Could not open SDE zip'));

      zip.on('error', reject);
      zip.on('end', resolve);
      zip.on('entry', (entry: yauzl.Entry) => {
        const handler = handlers[entry.fileName];
        if (!handler) {
          zip.readEntry();
          return;
        }
        zip.openReadStream(entry, (streamErr, stream) => {
          if (streamErr || !stream) return reject(streamErr ?? new Error('Could not read entry'));
          handler(stream)
            .then(() => zip.readEntry())
            .catch(reject);
        });
      });
      zip.readEntry();
    });
  });
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
      }));
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
  });

  onProgress?.({ phase: 'finalizing' });
  replaceTypes(typeRows);
  setSdeVersion(version);
  return { version, typeCount: typeRows.length };
}
