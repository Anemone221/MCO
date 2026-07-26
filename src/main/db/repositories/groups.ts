import type { CharacterGroup, OrgRef, PodSystemEntry } from '@shared/types';
import { getDb } from '../index';

interface GroupRow {
  id: number;
  name: string;
  color: string | null;
  priority_fit_id: number | null;
  priority_plan_id: number | null;
  home_station_id: number | null;
  home_station_name: string | null;
}

const GROUP_COLUMNS =
  'id, name, color, priority_fit_id, priority_plan_id, home_station_id, home_station_name';

function toGroup(
  row: GroupRow,
  characterIds: number[],
  podSystems: PodSystemEntry[],
): CharacterGroup {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    characterIds,
    priorityFitId: row.priority_fit_id,
    priorityPlanId: row.priority_plan_id,
    homeStationId: row.home_station_id,
    homeStationName: row.home_station_name,
    podSystems,
  };
}

/** Every group with its member character ids attached. */
export function listGroups(): CharacterGroup[] {
  const db = getDb();
  const rows = db
    .prepare(`SELECT ${GROUP_COLUMNS} FROM character_groups ORDER BY name`)
    .all() as GroupRow[];

  const memberRows = db
    .prepare('SELECT group_id, character_id FROM character_group_members')
    .all() as Array<{ group_id: number; character_id: number }>;

  const membersByGroup = new Map<number, number[]>();
  for (const r of memberRows) {
    const list = membersByGroup.get(r.group_id) ?? [];
    list.push(r.character_id);
    membersByGroup.set(r.group_id, list);
  }

  const podRows = db
    .prepare(
      'SELECT group_id, solar_system_id, system_name FROM group_pod_systems ORDER BY system_name',
    )
    .all() as Array<{ group_id: number; solar_system_id: number; system_name: string }>;
  const podsByGroup = new Map<number, PodSystemEntry[]>();
  for (const r of podRows) {
    const list = podsByGroup.get(r.group_id) ?? [];
    list.push({ solarSystemId: r.solar_system_id, systemName: r.system_name });
    podsByGroup.set(r.group_id, list);
  }

  return rows.map((row) =>
    toGroup(row, membersByGroup.get(row.id) ?? [], podsByGroup.get(row.id) ?? []),
  );
}

/** The pod-location whitelist of one group, in system-name order. */
function listPodSystems(groupId: number): PodSystemEntry[] {
  const rows = getDb()
    .prepare(
      'SELECT solar_system_id, system_name FROM group_pod_systems WHERE group_id = ? ORDER BY system_name',
    )
    .all(groupId) as Array<{ solar_system_id: number; system_name: string }>;
  return rows.map((r) => ({ solarSystemId: r.solar_system_id, systemName: r.system_name }));
}

/** One group with its member character ids, or null when it doesn't exist. */
export function getGroup(id: number): CharacterGroup | null {
  const db = getDb();
  const row = db
    .prepare(`SELECT ${GROUP_COLUMNS} FROM character_groups WHERE id = ?`)
    .get(id) as GroupRow | undefined;
  if (!row) return null;

  const members = db
    .prepare('SELECT character_id FROM character_group_members WHERE group_id = ?')
    .all(id) as Array<{ character_id: number }>;
  return toGroup(
    row,
    members.map((m) => m.character_id),
    listPodSystems(id),
  );
}

/** Groups one character belongs to, in name order. */
export function listGroupsForCharacter(characterId: number): OrgRef[] {
  return getDb()
    .prepare(
      `SELECT g.id, g.name, g.color FROM character_groups g
       JOIN character_group_members m ON m.group_id = g.id
       WHERE m.character_id = ? ORDER BY g.name`,
    )
    .all(characterId) as OrgRef[];
}

export function createGroup(name: string, color: string | null = null): CharacterGroup {
  const info = getDb()
    .prepare('INSERT INTO character_groups (name, color) VALUES (?, ?)')
    .run(name, color);
  return {
    id: Number(info.lastInsertRowid),
    name,
    color,
    characterIds: [],
    priorityFitId: null,
    priorityPlanId: null,
    homeStationId: null,
    homeStationName: null,
    podSystems: [],
  };
}

export function renameGroup(id: number, name: string): void {
  getDb().prepare('UPDATE character_groups SET name = ? WHERE id = ?').run(name, id);
}

/** The fit the group's members should work toward; null clears it. */
export function setGroupPriorityFit(id: number, fitId: number | null): void {
  getDb().prepare('UPDATE character_groups SET priority_fit_id = ? WHERE id = ?').run(fitId, id);
}

/** The skill plan the group's members should work toward; null clears it. */
export function setGroupPriorityPlan(id: number, planId: number | null): void {
  getDb()
    .prepare('UPDATE character_groups SET priority_plan_id = ? WHERE id = ?')
    .run(planId, id);
}

/**
 * The station/structure the group's members should keep their medical clone
 * at; null clears it. The name is denormalized so display never needs a
 * re-resolve (structure names can go stale in `structures` after ACL loss).
 */
export function setGroupHomeStation(
  id: number,
  station: { id: number; name: string } | null,
): void {
  getDb()
    .prepare('UPDATE character_groups SET home_station_id = ?, home_station_name = ? WHERE id = ?')
    .run(station?.id ?? null, station?.name ?? null, id);
}

/**
 * Add a solar system to the group's pod-location whitelist. The name is
 * denormalized from the SDE at pick time so display never needs a lookup.
 */
export function addGroupPodSystem(
  groupId: number,
  system: { id: number; name: string },
): void {
  getDb()
    .prepare(
      `INSERT INTO group_pod_systems (group_id, solar_system_id, system_name) VALUES (?, ?, ?)
       ON CONFLICT(group_id, solar_system_id) DO UPDATE SET system_name = excluded.system_name`,
    )
    .run(groupId, system.id, system.name);
}

export function removeGroupPodSystem(groupId: number, solarSystemId: number): void {
  getDb()
    .prepare('DELETE FROM group_pod_systems WHERE group_id = ? AND solar_system_id = ?')
    .run(groupId, solarSystemId);
}

/** In group_pod_ignores the active pod is stored as jump_clone_id 0 (ESI ids are positive). */
const ACTIVE_POD_ID = 0;

export interface GroupPodIgnoreRow {
  characterId: number;
  /** ESI jump-clone id, or null for the character's active pod. */
  jumpCloneId: number | null;
  ignoredAt: string;
}

/** Pods exempted from the group's whitelist check, oldest exemption first. */
export function listGroupPodIgnores(groupId: number): GroupPodIgnoreRow[] {
  const rows = getDb()
    .prepare(
      `SELECT character_id, jump_clone_id, ignored_at FROM group_pod_ignores
       WHERE group_id = ? ORDER BY ignored_at, character_id, jump_clone_id`,
    )
    .all(groupId) as Array<{ character_id: number; jump_clone_id: number; ignored_at: string }>;
  return rows.map((r) => ({
    characterId: r.character_id,
    jumpCloneId: r.jump_clone_id === ACTIVE_POD_ID ? null : r.jump_clone_id,
    ignoredAt: r.ignored_at,
  }));
}

/** Exempt a pod from the group's whitelist check; null jumpCloneId = the active pod. */
export function addGroupPodIgnore(
  groupId: number,
  characterId: number,
  jumpCloneId: number | null,
): void {
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO group_pod_ignores (group_id, character_id, jump_clone_id)
       VALUES (?, ?, ?)`,
    )
    .run(groupId, characterId, jumpCloneId ?? ACTIVE_POD_ID);
}

/** Lift a pod's exemption; null jumpCloneId = the active pod. */
export function removeGroupPodIgnore(
  groupId: number,
  characterId: number,
  jumpCloneId: number | null,
): void {
  getDb()
    .prepare(
      'DELETE FROM group_pod_ignores WHERE group_id = ? AND character_id = ? AND jump_clone_id = ?',
    )
    .run(groupId, characterId, jumpCloneId ?? ACTIVE_POD_ID);
}

export function removeGroup(id: number): void {
  getDb().prepare('DELETE FROM character_groups WHERE id = ?').run(id);
}

export function addMember(groupId: number, characterId: number): void {
  getDb()
    .prepare(
      'INSERT OR IGNORE INTO character_group_members (group_id, character_id) VALUES (?, ?)',
    )
    .run(groupId, characterId);
}

export function removeMember(groupId: number, characterId: number): void {
  getDb()
    .prepare('DELETE FROM character_group_members WHERE group_id = ? AND character_id = ?')
    .run(groupId, characterId);
}
