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
    'INSERT OR REPLACE INTO sde_types (id, group_id, name, published) VALUES (?, ?, ?, ?)',
  );
  db.transaction(() => {
    db.exec('DELETE FROM sde_types');
    for (const r of rows) ins.run(r.id, r.groupId, r.name, r.published);
  })();
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
  return {
    installed: row !== undefined,
    version: row?.version ?? null,
    importedAt: row?.imported_at ?? null,
    hasSkillData: skillData.present === 1,
    hasMapData: mapData.present === 1,
    hasSkillAttributes: skillAttributes.present === 1,
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
