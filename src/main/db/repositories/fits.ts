import type { Fit } from '@shared/types';
import { getDb } from '../index';

interface FitRow {
  id: number;
  name: string;
  ship_type_id: number | null;
  ship_name: string;
  eft_text: string;
  imported_at: string;
}

function toFit(row: FitRow): Fit {
  return {
    id: row.id,
    name: row.name,
    shipTypeId: row.ship_type_id,
    shipName: row.ship_name,
    eftText: row.eft_text,
    importedAt: row.imported_at,
  };
}

const COLUMNS = 'id, name, ship_type_id, ship_name, eft_text, imported_at';

export function listFits(): Fit[] {
  const rows = getDb()
    .prepare(`SELECT ${COLUMNS} FROM fits ORDER BY imported_at DESC`)
    .all() as FitRow[];
  return rows.map(toFit);
}

export function getFit(id: number): Fit | null {
  const row = getDb().prepare(`SELECT ${COLUMNS} FROM fits WHERE id = ?`).get(id) as
    | FitRow
    | undefined;
  return row ? toFit(row) : null;
}

export function createFit(input: {
  name: string;
  shipTypeId: number | null;
  shipName: string;
  eftText: string;
}): Fit {
  const info = getDb()
    .prepare(
      'INSERT INTO fits (name, ship_type_id, ship_name, eft_text) VALUES (@name, @shipTypeId, @shipName, @eftText)',
    )
    .run(input);
  return getFit(Number(info.lastInsertRowid))!;
}

export function removeFit(id: number): void {
  getDb().prepare('DELETE FROM fits WHERE id = ?').run(id);
}
