import { getDb } from '../index';

export interface CharacterOnlineRow {
  characterId: number;
  online: boolean;
  lastLogin: string | null;
  lastLogout: string | null;
  updatedAt: string;
}

interface OnlineDbRow {
  character_id: number;
  online: number;
  last_login: string | null;
  last_logout: string | null;
  updated_at: string;
}

function toRow(row: OnlineDbRow): CharacterOnlineRow {
  return {
    characterId: row.character_id,
    online: row.online === 1,
    lastLogin: row.last_login,
    lastLogout: row.last_logout,
    updatedAt: row.updated_at,
  };
}

export function upsertCharacterOnline(
  characterId: number,
  online: boolean,
  lastLogin: string | null,
  lastLogout: string | null,
): void {
  getDb()
    .prepare(
      `INSERT INTO character_online (character_id, online, last_login, last_logout, updated_at)
       VALUES (@characterId, @online, @lastLogin, @lastLogout, datetime('now'))
       ON CONFLICT(character_id) DO UPDATE SET
         online = excluded.online,
         last_login = excluded.last_login,
         last_logout = excluded.last_logout,
         updated_at = excluded.updated_at`,
    )
    .run({ characterId, online: online ? 1 : 0, lastLogin, lastLogout });
}

/** Online rows for every character that has synced this data at least once. */
export function listCharacterOnline(): CharacterOnlineRow[] {
  const rows = getDb()
    .prepare('SELECT character_id, online, last_login, last_logout, updated_at FROM character_online')
    .all() as OnlineDbRow[];
  return rows.map(toRow);
}
