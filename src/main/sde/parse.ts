import { createInterface } from 'node:readline';
import type { Readable } from 'node:stream';
import YAML from 'yaml';

export interface ParsedType {
  id: number;
  groupId: number;
  name: string;
  published: number;
}

export interface ParsedNamedEntry {
  id: number;
  name: string;
  published: number;
  categoryId?: number;
}

export interface TypesProgress {
  typesProcessed: number;
}

/** YAML scalar values in the SDE may be plain, single-, or double-quoted. */
export function parseYamlScalar(raw: string): string {
  const s = raw.trim();
  if (s.startsWith("'") && s.endsWith("'")) return s.slice(1, -1).replace(/''/g, "'");
  if (s.startsWith('"') && s.endsWith('"')) return JSON.parse(s) as string;
  return s;
}

interface LocalizedEntry {
  name?: { en?: string };
  published?: boolean;
  categoryID?: number;
}

/** Parse a small SDE file (categories/groups/regions) keyed by integer id. */
export function parseNamedFile(text: string): ParsedNamedEntry[] {
  const parsed = YAML.parse(text) as Record<string, LocalizedEntry>;
  return Object.entries(parsed).map(([key, value]) => ({
    id: Number(key),
    name: value.name?.en ?? `Entry ${key}`,
    published: value.published ? 1 : 0,
    categoryId: value.categoryID,
  }));
}

export interface ParsedSystem {
  id: number;
  name: string;
  regionId: number;
  security: number;
}

interface SolarSystemEntry {
  name?: { en?: string };
  regionID?: number;
  securityStatus?: number;
}

/** Parse mapSolarSystems.yaml into system id, name, region and security status. */
export function parseSolarSystems(text: string): ParsedSystem[] {
  const parsed = YAML.parse(text) as Record<string, SolarSystemEntry>;
  return Object.entries(parsed).map(([key, value]) => ({
    id: Number(key),
    name: value.name?.en ?? `System ${key}`,
    regionId: value.regionID ?? 0,
    security: value.securityStatus ?? 0,
  }));
}

/**
 * Stream types.yaml (152 MB) one top-level entry at a time, extracting just the
 * fields we persist. A targeted line scan avoids loading the whole file into
 * memory — the SDE YAML is machine-generated with a rigid, regular layout.
 */
export async function parseTypesStream(
  stream: Readable,
  onProgress?: (progress: TypesProgress) => void,
): Promise<ParsedType[]> {
  const rows: ParsedType[] = [];
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  let id: number | null = null;
  let groupId: number | null = null;
  let published = 0;
  let name: string | null = null;
  let inNameBlock = false;

  const flush = (): void => {
    if (id !== null && groupId !== null && name !== null) {
      rows.push({ id, groupId, name, published });
      if (rows.length % 10_000 === 0) onProgress?.({ typesProcessed: rows.length });
    }
  };

  for await (const line of rl) {
    const topLevel = /^(\d+):\s*$/.exec(line);
    if (topLevel) {
      flush();
      id = Number(topLevel[1]);
      groupId = null;
      published = 0;
      name = null;
      inNameBlock = false;
      continue;
    }
    if (id === null) continue;

    if (line.startsWith('  groupID:')) {
      groupId = Number(line.slice('  groupID:'.length).trim());
    } else if (line.startsWith('  published:')) {
      published = line.includes('true') ? 1 : 0;
    } else if (line === '  name:') {
      inNameBlock = true;
    } else if (inNameBlock && line.startsWith('    en:')) {
      name = parseYamlScalar(line.slice('    en:'.length));
      inNameBlock = false;
    } else if (inNameBlock && /^ {2}\S/.test(line)) {
      inNameBlock = false;
    }
  }
  flush();
  return rows;
}

export interface TypeSkillReq {
  typeId: number;
  skillTypeId: number;
  level: number;
}

export interface TypeRank {
  typeId: number;
  rank: number;
}

export interface TypeDogmaResult {
  skillReqs: TypeSkillReq[];
  ranks: TypeRank[];
}

/** Dogma attribute id pairs: [skill-typeId attribute, required-level attribute]. */
const SKILL_REQ_ATTR_PAIRS: ReadonlyArray<readonly [number, number]> = [
  [182, 277],
  [183, 278],
  [184, 279],
  [1285, 1286],
  [1289, 1287],
  [1290, 1288],
];
/** Dogma attribute id for skillTimeConstant (skill rank). */
const RANK_ATTR_ID = 275;

interface DogmaBlock {
  dogmaAttributes?: { attributeID: number; value: number }[];
}

/**
 * Stream typeDogma.yaml (26 MB) one top-level entry at a time, extracting skill
 * requirements and skill ranks. Each block is YAML-parsed individually — the
 * nested attribute lists make a line scan fragile, and per-block parsing keeps
 * memory flat.
 */
export async function parseTypeDogmaStream(
  stream: Readable,
  onProgress?: (progress: TypesProgress) => void,
): Promise<TypeDogmaResult> {
  const skillReqs: TypeSkillReq[] = [];
  const ranks: TypeRank[] = [];
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  let blockId: number | null = null;
  let blockLines: string[] = [];
  let processed = 0;

  const flush = (): void => {
    if (blockId === null) return;
    const parsed = YAML.parse(blockLines.join('\n')) as Record<string, DogmaBlock>;
    const attrs = parsed[String(blockId)]?.dogmaAttributes;
    if (attrs) {
      const byId = new Map<number, number>();
      for (const attr of attrs) byId.set(attr.attributeID, attr.value);

      for (const [skillAttr, levelAttr] of SKILL_REQ_ATTR_PAIRS) {
        const skillTypeId = byId.get(skillAttr);
        if (skillTypeId !== undefined && skillTypeId > 0) {
          skillReqs.push({
            typeId: blockId,
            skillTypeId: Math.round(skillTypeId),
            level: Math.round(byId.get(levelAttr) ?? 1),
          });
        }
      }

      const rank = byId.get(RANK_ATTR_ID);
      if (rank !== undefined && rank > 0) ranks.push({ typeId: blockId, rank });
    }
    processed += 1;
    if (processed % 10_000 === 0) onProgress?.({ typesProcessed: processed });
  };

  for await (const line of rl) {
    const topLevel = /^(\d+):\s*$/.exec(line);
    if (topLevel) {
      flush();
      blockId = Number(topLevel[1]);
      blockLines = [line];
    } else if (blockId !== null) {
      blockLines.push(line);
    }
  }
  flush();
  return { skillReqs, ranks };
}
