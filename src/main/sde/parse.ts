import { createInterface } from 'node:readline';
import type { Readable } from 'node:stream';
import YAML from 'yaml';

export interface ParsedType {
  id: number;
  groupId: number;
  name: string;
  published: number;
  /** Market group the type is sold under; null for types never on the market. */
  marketGroupId: number | null;
  /** Tech/meta tier (1 Tech I, 2 Tech II, 4 Faction, …); null when unset. */
  metaGroupId: number | null;
  /**
   * Volume of one unit in m³; null when the type carries no `volume` (a few
   * abstract types don't). This is what turns the mining ledger's unit counts
   * into the m³ a miner actually thinks in.
   */
  volume: number | null;
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
  /**
   * Position in the New Eden map, in metres; null for a system the SDE gives
   * no coordinates for. Only light-year distances need it — the unit every
   * capital jump range is quoted in.
   */
  x: number | null;
  y: number | null;
  z: number | null;
}

interface SolarSystemEntry {
  name?: { en?: string };
  regionID?: number;
  securityStatus?: number;
  position?: { x?: number; y?: number; z?: number };
}

/** Parse mapSolarSystems.yaml into system id, name, region, security and position. */
export function parseSolarSystems(text: string): ParsedSystem[] {
  const parsed = YAML.parse(text) as Record<string, SolarSystemEntry>;
  return Object.entries(parsed).map(([key, value]) => ({
    id: Number(key),
    name: value.name?.en ?? `System ${key}`,
    regionId: value.regionID ?? 0,
    security: value.securityStatus ?? 0,
    x: value.position?.x ?? null,
    y: value.position?.y ?? null,
    z: value.position?.z ?? null,
  }));
}

export interface ParsedStargate {
  fromSystemId: number;
  toSystemId: number;
}

interface StargateEntry {
  solarSystemID?: number;
  destination?: { solarSystemID?: number };
}

/**
 * Parse mapStargates.yaml into the system-to-system links the gate graph is
 * built from — one row per gate, from the system it sits in to the system it
 * leads to. Gates that name neither end (or both ends the same) are dropped;
 * everything else about a gate (its own id, type, position) is what a route
 * never needs to know.
 */
export function parseStargates(text: string): ParsedStargate[] {
  const parsed = YAML.parse(text) as Record<string, StargateEntry>;
  const jumps: ParsedStargate[] = [];
  for (const gate of Object.values(parsed)) {
    const from = gate.solarSystemID;
    const to = gate.destination?.solarSystemID;
    if (from === undefined || to === undefined || from === to) continue;
    jumps.push({ fromSystemId: from, toSystemId: to });
  }
  return jumps;
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
  let marketGroupId: number | null = null;
  let metaGroupId: number | null = null;
  let volume: number | null = null;
  let inNameBlock = false;

  const flush = (): void => {
    if (id !== null && groupId !== null && name !== null) {
      rows.push({ id, groupId, name, published, marketGroupId, metaGroupId, volume });
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
      marketGroupId = null;
      metaGroupId = null;
      volume = null;
      inNameBlock = false;
      continue;
    }
    if (id === null) continue;

    if (line.startsWith('  groupID:')) {
      groupId = Number(line.slice('  groupID:'.length).trim());
    } else if (line.startsWith('  volume:')) {
      const parsed = Number(line.slice('  volume:'.length).trim());
      volume = Number.isFinite(parsed) ? parsed : null;
    } else if (line.startsWith('  marketGroupID:')) {
      marketGroupId = Number(line.slice('  marketGroupID:'.length).trim());
    } else if (line.startsWith('  metaGroupID:')) {
      metaGroupId = Number(line.slice('  metaGroupID:'.length).trim());
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

export interface ParsedBlueprint {
  blueprintTypeId: number;
  /** What one run makes; null for a blueprint with neither activity (rare). */
  productTypeId: number | null;
  /** Which activity the product came from — reaction formulas are not manufactured. */
  activity: 'manufacturing' | 'reaction' | 'other';
  maxProductionLimit: number | null;
}

/**
 * Parse blueprints.yaml into "what does this blueprint make".
 *
 * Only the **manufacturing** (or, for reaction formulas, **reaction**) product
 * is taken. `invention` also carries a `products` list, but an invention
 * product is the Tech II blueprint the process yields, not what the blueprint
 * itself builds — reading it would file every Tech I blueprint under its Tech
 * II descendant. The same line-scan approach as types.yaml: the file is
 * machine-generated with a rigid layout, so tracking the current 4-space
 * activity key and the 6-space `products:` block is enough, without paying to
 * materialize 4 MB of nested YAML.
 */
export function parseBlueprints(text: string): ParsedBlueprint[] {
  const rows: ParsedBlueprint[] = [];

  type ProductActivity = 'manufacturing' | 'reaction';

  let id: number | null = null;
  let activityKey: string | null = null;
  /** The activity whose `products:` list we are currently inside, if any. */
  let productsFor: ProductActivity | null = null;
  let productTypeId: number | null = null;
  let productFrom: ProductActivity | null = null;
  let hasManufacturing = false;
  let hasReaction = false;
  let maxProductionLimit: number | null = null;

  const flush = (): void => {
    if (id === null) return;
    rows.push({
      blueprintTypeId: id,
      productTypeId,
      activity: hasManufacturing ? 'manufacturing' : hasReaction ? 'reaction' : 'other',
      maxProductionLimit,
    });
  };

  for (const line of text.split(/\r?\n/)) {
    const topLevel = /^(\d+):\s*$/.exec(line);
    if (topLevel) {
      flush();
      id = Number(topLevel[1]);
      activityKey = null;
      productsFor = null;
      productTypeId = null;
      productFrom = null;
      hasManufacturing = false;
      hasReaction = false;
      maxProductionLimit = null;
      continue;
    }
    if (id === null) continue;

    if (line.startsWith('  maxProductionLimit:')) {
      maxProductionLimit = Number(line.slice('  maxProductionLimit:'.length).trim());
      continue;
    }

    const activity = /^ {4}(\w+):\s*$/.exec(line);
    if (activity) {
      activityKey = activity[1]!;
      productsFor = null;
      if (activityKey === 'manufacturing') hasManufacturing = true;
      if (activityKey === 'reaction') hasReaction = true;
      continue;
    }

    if (/^ {6}products:\s*$/.test(line)) {
      productsFor =
        activityKey === 'manufacturing' || activityKey === 'reaction' ? activityKey : null;
      continue;
    }
    // Any other key at the activity's own depth ends the products list.
    if (/^ {6}\w+:/.test(line)) {
      productsFor = null;
      continue;
    }

    // First product of the block wins; manufacturing outranks reaction if a
    // blueprint somehow declares both.
    if (
      productsFor !== null &&
      (productFrom === null || (productFrom === 'reaction' && productsFor === 'manufacturing'))
    ) {
      const match = /typeID:\s*(\d+)/.exec(line);
      if (match) {
        productTypeId = Number(match[1]);
        productFrom = productsFor;
      }
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

export interface TypeSkillAttributes {
  typeId: number;
  primaryAttributeId: number;
  secondaryAttributeId: number;
}

export interface TypeDogmaResult {
  skillReqs: TypeSkillReq[];
  ranks: TypeRank[];
  skillAttributes: TypeSkillAttributes[];
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
/** Dogma attribute ids whose values name a skill's training attributes. */
const PRIMARY_ATTR_ID = 180;
const SECONDARY_ATTR_ID = 181;

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
  const skillAttributes: TypeSkillAttributes[] = [];
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

      const primary = byId.get(PRIMARY_ATTR_ID);
      const secondary = byId.get(SECONDARY_ATTR_ID);
      if (primary !== undefined && primary > 0 && secondary !== undefined && secondary > 0) {
        skillAttributes.push({
          typeId: blockId,
          primaryAttributeId: Math.round(primary),
          secondaryAttributeId: Math.round(secondary),
        });
      }
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
  return { skillReqs, ranks, skillAttributes };
}
