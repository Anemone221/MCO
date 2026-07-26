import { getDb } from '../index';

export interface JumpCloneRow {
  jumpCloneId: number;
  name: string | null;
  locationId: number | null;
  locationType: string | null;
  implants: number[];
}

/** Replace the active-clone implant set for a character in one transaction. */
export function replaceActiveImplants(characterId: number, implantTypeIds: number[]): void {
  const db = getDb();
  const del = db.prepare('DELETE FROM character_implants WHERE character_id = ?');
  const ins = db.prepare(
    'INSERT INTO character_implants (character_id, implant_type_id) VALUES (?, ?)',
  );
  db.transaction(() => {
    del.run(characterId);
    for (const typeId of implantTypeIds) ins.run(characterId, typeId);
    touchCloneMeta(characterId);
  })();
}

export interface CloneSyncMeta {
  /** ESI's last_clone_jump_date; null if the character has never clone-jumped. */
  lastCloneJumpDate: string | null;
  /** Medical (home) clone location, from ESI's home_location. */
  homeLocationId: number | null;
  homeLocationType: string | null;
}

/** Replace the full jump-clone set (with implants) for a character in one transaction. */
export function replaceJumpClones(
  characterId: number,
  clones: JumpCloneRow[],
  meta: CloneSyncMeta,
): void {
  const db = getDb();
  const delClones = db.prepare('DELETE FROM character_clones WHERE character_id = ?');
  const insClone = db.prepare(
    `INSERT INTO character_clones (character_id, jump_clone_id, name, location_id, location_type)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const insImplant = db.prepare(
    `INSERT INTO character_clone_implants (character_id, jump_clone_id, implant_type_id)
     VALUES (?, ?, ?)`,
  );
  db.transaction(() => {
    delClones.run(characterId);
    for (const clone of clones) {
      insClone.run(characterId, clone.jumpCloneId, clone.name, clone.locationId, clone.locationType);
      for (const typeId of clone.implants) insImplant.run(characterId, clone.jumpCloneId, typeId);
    }
    touchCloneMeta(characterId);
    db.prepare(
      `UPDATE character_clones_meta
       SET last_clone_jump_date = ?, home_location_id = ?, home_location_type = ?
       WHERE character_id = ?`,
    ).run(meta.lastCloneJumpDate, meta.homeLocationId, meta.homeLocationType, characterId);
  })();
}

function touchCloneMeta(characterId: number): void {
  getDb()
    .prepare(
      `INSERT INTO character_clones_meta (character_id, updated_at) VALUES (?, datetime('now'))
       ON CONFLICT(character_id) DO UPDATE SET updated_at = datetime('now')`,
    )
    .run(characterId);
}

/** Active-clone implant type ids for every character. */
export function getAllActiveImplants(): Map<number, number[]> {
  const rows = getDb()
    .prepare('SELECT character_id, implant_type_id FROM character_implants')
    .all() as Array<{ character_id: number; implant_type_id: number }>;
  const map = new Map<number, number[]>();
  for (const r of rows) {
    const list = map.get(r.character_id) ?? [];
    list.push(r.implant_type_id);
    map.set(r.character_id, list);
  }
  return map;
}

/** Jump clones (with implants) for every character. */
export function getAllJumpClones(): Map<number, JumpCloneRow[]> {
  const db = getDb();
  const cloneRows = db
    .prepare(
      `SELECT character_id, jump_clone_id, name, location_id, location_type
       FROM character_clones ORDER BY character_id, jump_clone_id`,
    )
    .all() as Array<{
    character_id: number;
    jump_clone_id: number;
    name: string | null;
    location_id: number | null;
    location_type: string | null;
  }>;
  const implantRows = db
    .prepare('SELECT character_id, jump_clone_id, implant_type_id FROM character_clone_implants')
    .all() as Array<{ character_id: number; jump_clone_id: number; implant_type_id: number }>;

  const implantsByClone = new Map<string, number[]>();
  for (const r of implantRows) {
    const key = `${r.character_id}:${r.jump_clone_id}`;
    const list = implantsByClone.get(key) ?? [];
    list.push(r.implant_type_id);
    implantsByClone.set(key, list);
  }

  const map = new Map<number, JumpCloneRow[]>();
  for (const r of cloneRows) {
    const list = map.get(r.character_id) ?? [];
    list.push({
      jumpCloneId: r.jump_clone_id,
      name: r.name,
      locationId: r.location_id,
      locationType: r.location_type,
      implants: implantsByClone.get(`${r.character_id}:${r.jump_clone_id}`) ?? [],
    });
    map.set(r.character_id, list);
  }
  return map;
}

/** Jump clones (with implants) for one character. */
export function getJumpClones(characterId: number): JumpCloneRow[] {
  const db = getDb();
  const cloneRows = db
    .prepare(
      `SELECT jump_clone_id, name, location_id, location_type
       FROM character_clones WHERE character_id = ? ORDER BY jump_clone_id`,
    )
    .all(characterId) as Array<{
    jump_clone_id: number;
    name: string | null;
    location_id: number | null;
    location_type: string | null;
  }>;
  const implantRows = db
    .prepare(
      'SELECT jump_clone_id, implant_type_id FROM character_clone_implants WHERE character_id = ?',
    )
    .all(characterId) as Array<{ jump_clone_id: number; implant_type_id: number }>;

  const implantsByClone = new Map<number, number[]>();
  for (const r of implantRows) {
    const list = implantsByClone.get(r.jump_clone_id) ?? [];
    list.push(r.implant_type_id);
    implantsByClone.set(r.jump_clone_id, list);
  }

  return cloneRows.map((r) => ({
    jumpCloneId: r.jump_clone_id,
    name: r.name,
    locationId: r.location_id,
    locationType: r.location_type,
    implants: implantsByClone.get(r.jump_clone_id) ?? [],
  }));
}

export interface CloneMetaRow extends CloneSyncMeta {
  updatedAt: string;
}

interface CloneMetaDbRow {
  character_id: number;
  updated_at: string;
  last_clone_jump_date: string | null;
  home_location_id: number | null;
  home_location_type: string | null;
}

function toMetaRow(row: CloneMetaDbRow): CloneMetaRow {
  return {
    updatedAt: row.updated_at,
    lastCloneJumpDate: row.last_clone_jump_date,
    homeLocationId: row.home_location_id,
    homeLocationType: row.home_location_type,
  };
}

/** Clone-sync metadata for one character, or null if clone data has never synced. */
export function getCloneMeta(characterId: number): CloneMetaRow | null {
  const row = getDb()
    .prepare(
      `SELECT character_id, updated_at, last_clone_jump_date, home_location_id, home_location_type
       FROM character_clones_meta WHERE character_id = ?`,
    )
    .get(characterId) as CloneMetaDbRow | undefined;
  return row ? toMetaRow(row) : null;
}

/** Clone-sync metadata per character (present only once clone data has synced). */
export function getAllCloneMeta(): Map<number, CloneMetaRow> {
  const rows = getDb()
    .prepare(
      `SELECT character_id, updated_at, last_clone_jump_date, home_location_id, home_location_type
       FROM character_clones_meta`,
    )
    .all() as CloneMetaDbRow[];
  return new Map(rows.map((r) => [r.character_id, toMetaRow(r)]));
}
