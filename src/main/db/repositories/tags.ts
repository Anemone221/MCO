import type { OrgRef, Tag } from '@shared/types';
import { getDb } from '../index';

interface TagRow {
  id: number;
  name: string;
  color: string | null;
}

/** Every tag (capability) with the character ids that have it attached. */
export function listTags(): Tag[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT id, name, color FROM tags ORDER BY name')
    .all() as TagRow[];

  const memberRows = db
    .prepare('SELECT tag_id, character_id FROM character_tags')
    .all() as Array<{ tag_id: number; character_id: number }>;

  const membersByTag = new Map<number, number[]>();
  for (const r of memberRows) {
    const list = membersByTag.get(r.tag_id) ?? [];
    list.push(r.character_id);
    membersByTag.set(r.tag_id, list);
  }

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    color: row.color,
    characterIds: membersByTag.get(row.id) ?? [],
  }));
}

/** Tags (capabilities) one character holds, in name order. */
export function listTagsForCharacter(characterId: number): OrgRef[] {
  return getDb()
    .prepare(
      `SELECT t.id, t.name, t.color FROM tags t
       JOIN character_tags ct ON ct.tag_id = t.id
       WHERE ct.character_id = ? ORDER BY t.name`,
    )
    .all(characterId) as TagRow[];
}

export function createTag(name: string, color: string | null = null): Tag {
  const info = getDb().prepare('INSERT INTO tags (name, color) VALUES (?, ?)').run(name, color);
  return { id: Number(info.lastInsertRowid), name, color, characterIds: [] };
}

export function renameTag(id: number, name: string): void {
  getDb().prepare('UPDATE tags SET name = ? WHERE id = ?').run(name, id);
}

export function setTagColor(id: number, color: string | null): void {
  getDb().prepare('UPDATE tags SET color = ? WHERE id = ?').run(color, id);
}

export function removeTag(id: number): void {
  getDb().prepare('DELETE FROM tags WHERE id = ?').run(id);
}

export function addTagToCharacter(tagId: number, characterId: number): void {
  getDb()
    .prepare('INSERT OR IGNORE INTO character_tags (tag_id, character_id) VALUES (?, ?)')
    .run(tagId, characterId);
}

/**
 * Attach one tag to many characters in a single transaction — the bulk
 * "everyone in this fit/plan section can do X" assignment. Already-tagged
 * characters are ignored, so re-applying is a no-op.
 */
export function addTagToCharacters(tagId: number, characterIds: number[]): void {
  const db = getDb();
  const stmt = db.prepare(
    'INSERT OR IGNORE INTO character_tags (tag_id, character_id) VALUES (?, ?)',
  );
  const insertAll = db.transaction((ids: number[]) => {
    for (const characterId of ids) stmt.run(tagId, characterId);
  });
  insertAll(characterIds);
}

export function removeTagFromCharacter(tagId: number, characterId: number): void {
  getDb()
    .prepare('DELETE FROM character_tags WHERE tag_id = ? AND character_id = ?')
    .run(tagId, characterId);
}
