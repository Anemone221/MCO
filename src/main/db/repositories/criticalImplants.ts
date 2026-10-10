import { getDb } from '../index';

export interface CriticalImplantSetRow {
  characterId: number;
  /** clones/criticalImplants.ts implantSetKey. */
  implantKey: string;
  label: string | null;
}

/** Critical implant-set keys per character. */
export function getAllCriticalImplantSets(): Map<number, CriticalImplantSetRow[]> {
  const rows = getDb()
    .prepare('SELECT character_id, implant_key, label FROM critical_implant_sets')
    .all() as Array<{ character_id: number; implant_key: string; label: string | null }>;
  const map = new Map<number, CriticalImplantSetRow[]>();
  for (const r of rows) {
    const list = map.get(r.character_id) ?? [];
    list.push({ characterId: r.character_id, implantKey: r.implant_key, label: r.label });
    map.set(r.character_id, list);
  }
  return map;
}

export function addCriticalImplantSet(
  characterId: number,
  implantKey: string,
  label: string | null,
): void {
  getDb()
    .prepare(
      `INSERT INTO critical_implant_sets (character_id, implant_key, label) VALUES (?, ?, ?)
       ON CONFLICT (character_id, implant_key) DO UPDATE SET label = excluded.label`,
    )
    .run(characterId, implantKey, label);
}

export function removeCriticalImplantSet(characterId: number, implantKey: string): void {
  getDb()
    .prepare('DELETE FROM critical_implant_sets WHERE character_id = ? AND implant_key = ?')
    .run(characterId, implantKey);
}
