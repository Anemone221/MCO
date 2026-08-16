import type { SdeStatus, SystemSearchResult } from '@shared/types';
import { getDb } from '../index';

export interface SdeNamedRow {
  id: number;
  name: string;
  published: number;
}

export interface SdeGroupRow extends SdeNamedRow {
  categoryId: number;
}

export interface SdeTypeRow extends SdeNamedRow {
  groupId: number;
  marketGroupId: number | null;
  metaGroupId: number | null;
}

export function replaceCategories(rows: SdeNamedRow[]): void {
  const db = getDb();
  const ins = db.prepare('INSERT OR REPLACE INTO sde_categories (id, name, published) VALUES (?, ?, ?)');
  db.transaction(() => {
    db.exec('DELETE FROM sde_categories');
    for (const r of rows) ins.run(r.id, r.name, r.published);
  })();
}

export function replaceGroups(rows: SdeGroupRow[]): void {
  const db = getDb();
  const ins = db.prepare(
    'INSERT OR REPLACE INTO sde_groups (id, category_id, name, published) VALUES (?, ?, ?, ?)',
  );
  db.transaction(() => {
    db.exec('DELETE FROM sde_groups');
    for (const r of rows) ins.run(r.id, r.categoryId, r.name, r.published);
  })();
}

export function replaceTypes(rows: SdeTypeRow[]): void {
  const db = getDb();
  const ins = db.prepare(
    `INSERT OR REPLACE INTO sde_types (id, group_id, name, published, market_group_id, meta_group_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  db.transaction(() => {
    db.exec('DELETE FROM sde_types');
    for (const r of rows) {
      ins.run(r.id, r.groupId, r.name, r.published, r.marketGroupId, r.metaGroupId);
    }
  })();
}

export interface SdeBlueprintRow {
  blueprintTypeId: number;
  productTypeId: number | null;
  activity: string;
  maxProductionLimit: number | null;
}

export function replaceBlueprints(rows: SdeBlueprintRow[]): void {
  const db = getDb();
  const ins = db.prepare(
    `INSERT OR REPLACE INTO sde_blueprints
       (blueprint_type_id, product_type_id, activity, max_production_limit)
     VALUES (?, ?, ?, ?)`,
  );
  db.transaction(() => {
    db.exec('DELETE FROM sde_blueprints');
    for (const r of rows) {
      ins.run(r.blueprintTypeId, r.productTypeId, r.activity, r.maxProductionLimit);
    }
  })();
}

/** One row of the blueprint checklist's universe, joined to its product's taxonomy. */
export interface BlueprintCatalogRow {
  typeId: number;
  name: string;
  activity: string;
  maxProductionLimit: number | null;
  productTypeId: number | null;
  productName: string | null;
  groupId: number | null;
  groupName: string | null;
  categoryId: number | null;
  categoryName: string | null;
  metaGroupId: number | null;
  /**
   * The blueprint type is (or was) sold on the market, which is what marks it
   * as one that exists as an original. Invention- and drop-only blueprints —
   * every Tech III, most faction — have no market group and only ever exist as
   * copies.
   */
  marketSeeded: boolean;
}

/**
 * Every published blueprint in the SDE, with the group/category of the item it
 * makes. Blueprint types all sit in the "Blueprint" category themselves, so the
 * product's taxonomy is the only one worth grouping a checklist by.
 * Unpublished blueprints are excluded — they are removed or never-released
 * types that cannot be owned.
 */
export function getBlueprintCatalog(): BlueprintCatalogRow[] {
  const rows = getDb()
    .prepare(
      `SELECT b.blueprint_type_id   AS type_id,
              bt.name               AS name,
              bt.market_group_id    AS market_group_id,
              b.activity            AS activity,
              b.max_production_limit AS max_production_limit,
              b.product_type_id     AS product_type_id,
              pt.name               AS product_name,
              pt.meta_group_id      AS meta_group_id,
              pt.group_id           AS group_id,
              g.name                AS group_name,
              g.category_id         AS category_id,
              c.name                AS category_name
       FROM sde_blueprints b
       JOIN sde_types bt ON bt.id = b.blueprint_type_id
       LEFT JOIN sde_types pt ON pt.id = b.product_type_id
       LEFT JOIN sde_groups g ON g.id = pt.group_id
       LEFT JOIN sde_categories c ON c.id = g.category_id
       WHERE bt.published = 1
       ORDER BY bt.name`,
    )
    .all() as Array<{
    type_id: number;
    name: string;
    market_group_id: number | null;
    activity: string;
    max_production_limit: number | null;
    product_type_id: number | null;
    product_name: string | null;
    meta_group_id: number | null;
    group_id: number | null;
    group_name: string | null;
    category_id: number | null;
    category_name: string | null;
  }>;

  return rows.map((r) => ({
    typeId: r.type_id,
    name: r.name,
    activity: r.activity,
    maxProductionLimit: r.max_production_limit,
    productTypeId: r.product_type_id,
    productName: r.product_name,
    groupId: r.group_id,
    groupName: r.group_name,
    categoryId: r.category_id,
    categoryName: r.category_name,
    metaGroupId: r.meta_group_id,
    marketSeeded: r.market_group_id !== null,
  }));
}

export interface SkillReqRow {
  typeId: number;
  skillTypeId: number;
  level: number;
}

export interface SkillRankRow {
  skillTypeId: number;
  rank: number;
}

export function replaceTypeSkillReqs(rows: SkillReqRow[]): void {
  const db = getDb();
  const ins = db.prepare(
    'INSERT OR REPLACE INTO sde_type_skill_reqs (type_id, skill_type_id, level) VALUES (?, ?, ?)',
  );
  db.transaction(() => {
    db.exec('DELETE FROM sde_type_skill_reqs');
    for (const r of rows) ins.run(r.typeId, r.skillTypeId, r.level);
  })();
}

export function replaceSkillRanks(rows: SkillRankRow[]): void {
  const db = getDb();
  const ins = db.prepare(
    'INSERT OR REPLACE INTO sde_skill_ranks (skill_type_id, rank) VALUES (?, ?)',
  );
  db.transaction(() => {
    db.exec('DELETE FROM sde_skill_ranks');
    for (const r of rows) ins.run(r.skillTypeId, r.rank);
  })();
}

export interface SkillAttributeRow {
  skillTypeId: number;
  primaryAttributeId: number;
  secondaryAttributeId: number;
}

export function replaceSkillAttributes(rows: SkillAttributeRow[]): void {
  const db = getDb();
  const ins = db.prepare(
    'INSERT OR REPLACE INTO sde_skill_attributes (skill_type_id, primary_attribute_id, secondary_attribute_id) VALUES (?, ?, ?)',
  );
  db.transaction(() => {
    db.exec('DELETE FROM sde_skill_attributes');
    for (const r of rows) ins.run(r.skillTypeId, r.primaryAttributeId, r.secondaryAttributeId);
  })();
}

/** Training attributes (dogma 180/181 values) keyed by skill type id. */
export function getSkillAttributes(
  skillTypeIds: number[],
): Map<number, { primaryAttributeId: number; secondaryAttributeId: number }> {
  const result = new Map<number, { primaryAttributeId: number; secondaryAttributeId: number }>();
  if (skillTypeIds.length === 0) return result;
  const placeholders = skillTypeIds.map(() => '?').join(',');
  const rows = getDb()
    .prepare(
      `SELECT skill_type_id, primary_attribute_id, secondary_attribute_id
       FROM sde_skill_attributes WHERE skill_type_id IN (${placeholders})`,
    )
    .all(...skillTypeIds) as Array<{
    skill_type_id: number;
    primary_attribute_id: number;
    secondary_attribute_id: number;
  }>;
  for (const r of rows) {
    result.set(r.skill_type_id, {
      primaryAttributeId: r.primary_attribute_id,
      secondaryAttributeId: r.secondary_attribute_id,
    });
  }
  return result;
}

/** SDE category holding every trainable skill. */
const SKILL_CATEGORY_ID = 16;

/** A skill type as the plan creator lists it: name, group, rank, published. */
export interface SkillTypeRow {
  skillTypeId: number;
  name: string;
  groupId: number | null;
  groupName: string | null;
  rank: number;
  published: boolean;
}

const SKILL_SELECT = `SELECT t.id            AS id,
                             t.name          AS name,
                             t.published     AS published,
                             g.id            AS group_id,
                             g.name          AS group_name,
                             COALESCE(r.rank, 1) AS rank
                      FROM sde_types t
                      JOIN sde_groups g ON g.id = t.group_id
                      LEFT JOIN sde_skill_ranks r ON r.skill_type_id = t.id`;

interface SkillTypeQueryRow {
  id: number;
  name: string;
  published: number;
  group_id: number | null;
  group_name: string | null;
  rank: number;
}

function toSkillTypeRow(row: SkillTypeQueryRow): SkillTypeRow {
  return {
    skillTypeId: row.id,
    name: row.name,
    groupId: row.group_id,
    groupName: row.group_name,
    rank: row.rank,
    published: row.published === 1,
  };
}

/**
 * Every skill in the game (SDE category 16), for the plan creator's browser.
 * Around 600 rows — small enough to hand the renderer once, which is what lets
 * it filter, expand and cost a draft without another round-trip.
 *
 * Retired (unpublished) skills are included and flagged rather than filtered:
 * an existing plan may still name one, and dropping it would silently edit the
 * plan. The browser leaves them out; the draft table still shows them.
 */
export function getSkillCatalog(): SkillTypeRow[] {
  const rows = getDb()
    .prepare(`${SKILL_SELECT} WHERE g.category_id = ? ORDER BY g.name, t.name`)
    .all(SKILL_CATEGORY_ID) as SkillTypeQueryRow[];
  return rows.map(toSkillTypeRow);
}

/** SDE category holding every ship hull. */
const SHIP_CATEGORY_ID = 6;

export interface ShipTypeRow {
  shipTypeId: number;
  name: string;
  groupId: number | null;
  groupName: string | null;
}

/**
 * Every published hull (SDE category 6) with its group, for the plan creator's
 * ship browser. ~415 rows, so like the skill catalogue it goes over in one
 * payload and is browsed and filtered in the renderer.
 */
export function getShipCatalog(): ShipTypeRow[] {
  const rows = getDb()
    .prepare(
      `SELECT t.id AS id, t.name AS name, g.id AS group_id, g.name AS group_name
       FROM sde_types t JOIN sde_groups g ON g.id = t.group_id
       WHERE g.category_id = ? AND t.published = 1
       ORDER BY g.name, t.name`,
    )
    .all(SHIP_CATEGORY_ID) as Array<{
    id: number;
    name: string;
    group_id: number | null;
    group_name: string | null;
  }>;
  return rows.map((row) => ({
    shipTypeId: row.id,
    name: row.name,
    groupId: row.group_id,
    groupName: row.group_name,
  }));
}

/** Name/group/rank for specific skill type ids. */
export function getSkillTypes(skillTypeIds: number[]): SkillTypeRow[] {
  if (skillTypeIds.length === 0) return [];
  const placeholders = skillTypeIds.map(() => '?').join(',');
  const rows = getDb()
    .prepare(`${SKILL_SELECT} WHERE t.id IN (${placeholders})`)
    .all(...skillTypeIds) as SkillTypeQueryRow[];
  return rows.map(toSkillTypeRow);
}

/**
 * Resolve names to *skill* type ids (case-insensitively), for reading a written
 * plan back into the creator. Unlike `resolveTypeIdsByName` this refuses
 * non-skills: a plan line naming a ship must read as unrecognised rather than
 * become a row whose prerequisites are a hull's.
 */
export function resolveSkillIdsByName(names: string[]): {
  resolved: Map<string, number>;
  unresolved: string[];
} {
  const resolved = new Map<string, number>();
  const unresolved: string[] = [];
  if (names.length === 0) return { resolved, unresolved };

  const unique = [...new Set(names)];
  const placeholders = unique.map(() => '?').join(',');
  const rows = getDb()
    .prepare(
      `SELECT t.id AS id, t.name AS name
       FROM sde_types t JOIN sde_groups g ON g.id = t.group_id
       WHERE g.category_id = ? AND t.name IN (${placeholders}) COLLATE NOCASE`,
    )
    .all(SKILL_CATEGORY_ID, ...unique) as Array<{ id: number; name: string }>;

  const byLower = new Map<string, number>();
  for (const r of rows) byLower.set(r.name.toLowerCase(), r.id);

  for (const name of unique) {
    const id = byLower.get(name.toLowerCase());
    if (id !== undefined) resolved.set(name, id);
    else unresolved.push(name);
  }
  return { resolved, unresolved };
}

/** Direct skill requirements for the given type ids. */
export function getSkillReqsForTypes(typeIds: number[]): SkillReqRow[] {
  if (typeIds.length === 0) return [];
  const placeholders = typeIds.map(() => '?').join(',');
  const rows = getDb()
    .prepare(
      `SELECT type_id, skill_type_id, level FROM sde_type_skill_reqs WHERE type_id IN (${placeholders})`,
    )
    .all(...typeIds) as Array<{ type_id: number; skill_type_id: number; level: number }>;
  return rows.map((r) => ({ typeId: r.type_id, skillTypeId: r.skill_type_id, level: r.level }));
}

/** Skill ranks (skillTimeConstant) keyed by skill type id. */
export function getSkillRanks(skillTypeIds: number[]): Map<number, number> {
  const result = new Map<number, number>();
  if (skillTypeIds.length === 0) return result;
  const placeholders = skillTypeIds.map(() => '?').join(',');
  const rows = getDb()
    .prepare(`SELECT skill_type_id, rank FROM sde_skill_ranks WHERE skill_type_id IN (${placeholders})`)
    .all(...skillTypeIds) as Array<{ skill_type_id: number; rank: number }>;
  for (const r of rows) result.set(r.skill_type_id, r.rank);
  return result;
}

/** Resolve type names to ids (case-insensitively). Returns resolved map + unresolved names. */
export function resolveTypeIdsByName(names: string[]): {
  resolved: Map<string, number>;
  unresolved: string[];
} {
  const resolved = new Map<string, number>();
  const unresolved: string[] = [];
  if (names.length === 0) return { resolved, unresolved };

  const unique = [...new Set(names)];
  const placeholders = unique.map(() => '?').join(',');
  const rows = getDb()
    .prepare(`SELECT id, name FROM sde_types WHERE name IN (${placeholders}) COLLATE NOCASE`)
    .all(...unique) as Array<{ id: number; name: string }>;

  const byLower = new Map<string, number>();
  for (const r of rows) byLower.set(r.name.toLowerCase(), r.id);

  for (const name of unique) {
    const id = byLower.get(name.toLowerCase());
    if (id !== undefined) resolved.set(name, id);
    else unresolved.push(name);
  }
  return { resolved, unresolved };
}

/** Map each type id to its SDE category id (via its group). */
export function getCategoryForTypes(typeIds: number[]): Map<number, number> {
  const result = new Map<number, number>();
  if (typeIds.length === 0) return result;
  const placeholders = typeIds.map(() => '?').join(',');
  const rows = getDb()
    .prepare(
      `SELECT t.id AS id, g.category_id AS category_id
       FROM sde_types t JOIN sde_groups g ON t.group_id = g.id
       WHERE t.id IN (${placeholders})`,
    )
    .all(...typeIds) as Array<{ id: number; category_id: number }>;
  for (const r of rows) result.set(r.id, r.category_id);
  return result;
}

export interface RegionRow {
  id: number;
  name: string;
}

export interface SystemRow {
  id: number;
  name: string;
  regionId: number;
  security: number;
}

export function replaceRegions(rows: RegionRow[]): void {
  const db = getDb();
  const ins = db.prepare('INSERT OR REPLACE INTO sde_regions (id, name) VALUES (?, ?)');
  db.transaction(() => {
    db.exec('DELETE FROM sde_regions');
    for (const r of rows) ins.run(r.id, r.name);
  })();
}

export function replaceSystems(rows: SystemRow[]): void {
  const db = getDb();
  const ins = db.prepare(
    'INSERT OR REPLACE INTO sde_systems (id, name, region_id, security) VALUES (?, ?, ?, ?)',
  );
  db.transaction(() => {
    db.exec('DELETE FROM sde_systems');
    for (const r of rows) ins.run(r.id, r.name, r.regionId, r.security);
  })();
}

export interface SystemInfo {
  id: number;
  name: string;
  security: number;
  regionId: number;
  regionName: string | null;
}

/** Resolve solar system ids to name/security/region in one query. */
export function getSystems(systemIds: number[]): Map<number, SystemInfo> {
  const result = new Map<number, SystemInfo>();
  if (systemIds.length === 0) return result;
  const placeholders = systemIds.map(() => '?').join(',');
  const rows = getDb()
    .prepare(
      `SELECT s.id AS id, s.name AS name, s.security AS security,
              s.region_id AS region_id, r.name AS region_name
       FROM sde_systems s LEFT JOIN sde_regions r ON s.region_id = r.id
       WHERE s.id IN (${placeholders})`,
    )
    .all(...systemIds) as Array<{
    id: number;
    name: string;
    security: number;
    region_id: number;
    region_name: string | null;
  }>;
  for (const row of rows) {
    result.set(row.id, {
      id: row.id,
      name: row.name,
      security: row.security,
      regionId: row.region_id,
      regionName: row.region_name,
    });
  }
  return result;
}

/**
 * Solar systems whose name contains the query, for the pod-whitelist picker.
 * Case-insensitive; `%`/`_` in the query are matched literally. Exact-name
 * hits sort first so typing "Jita" doesn't bury Jita under fuzzy matches.
 */
export function searchSystemsByName(query: string, limit = 15): SystemSearchResult[] {
  const needle = query.trim().replace(/[\\%_]/g, (c) => `\\${c}`);
  if (needle === '') return [];
  const rows = getDb()
    .prepare(
      `SELECT s.id AS id, s.name AS name, s.security AS security, r.name AS region_name
       FROM sde_systems s LEFT JOIN sde_regions r ON s.region_id = r.id
       WHERE s.name LIKE ? ESCAPE '\\'
       ORDER BY (s.name = ? COLLATE NOCASE) DESC, s.name LIMIT ?`,
    )
    .all(`%${needle}%`, query.trim(), limit) as Array<{
    id: number;
    name: string;
    security: number;
    region_name: string | null;
  }>;
  return rows.map((r) => ({
    solarSystemId: r.id,
    name: r.name,
    security: r.security,
    regionName: r.region_name,
  }));
}

export function setSdeVersion(version: string): void {
  getDb()
    .prepare(
      `INSERT INTO sde_version (id, version, imported_at) VALUES (1, ?, datetime('now'))
       ON CONFLICT(id) DO UPDATE SET version = excluded.version, imported_at = excluded.imported_at`,
    )
    .run(version);
}

export function getSdeStatus(): SdeStatus {
  const row = getDb()
    .prepare('SELECT version, imported_at FROM sde_version WHERE id = 1')
    .get() as { version: string; imported_at: string } | undefined;
  const skillData = getDb()
    .prepare('SELECT EXISTS(SELECT 1 FROM sde_type_skill_reqs LIMIT 1) AS present')
    .get() as { present: number };
  const mapData = getDb()
    .prepare('SELECT EXISTS(SELECT 1 FROM sde_systems LIMIT 1) AS present')
    .get() as { present: number };
  const skillAttributes = getDb()
    .prepare('SELECT EXISTS(SELECT 1 FROM sde_skill_attributes LIMIT 1) AS present')
    .get() as { present: number };
  const blueprintData = getDb()
    .prepare('SELECT EXISTS(SELECT 1 FROM sde_blueprints LIMIT 1) AS present')
    .get() as { present: number };
  return {
    installed: row !== undefined,
    version: row?.version ?? null,
    importedAt: row?.imported_at ?? null,
    hasSkillData: skillData.present === 1,
    hasMapData: mapData.present === 1,
    hasSkillAttributes: skillAttributes.present === 1,
    hasBlueprintData: blueprintData.present === 1,
  };
}

export function getTypeName(typeId: number): string | null {
  const row = getDb()
    .prepare('SELECT name FROM sde_types WHERE id = ?')
    .get(typeId) as { name: string } | undefined;
  return row?.name ?? null;
}

/** Resolve many type ids to names in one query. Unknown ids are omitted from the map. */
export function getTypeNames(typeIds: number[]): Map<number, string> {
  const result = new Map<number, string>();
  if (typeIds.length === 0) return result;
  const placeholders = typeIds.map(() => '?').join(',');
  const rows = getDb()
    .prepare(`SELECT id, name FROM sde_types WHERE id IN (${placeholders})`)
    .all(...typeIds) as Array<{ id: number; name: string }>;
  for (const r of rows) result.set(r.id, r.name);
  return result;
}
