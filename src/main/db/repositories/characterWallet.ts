import { getDb } from '../index';

export interface CharacterWalletRow {
  characterId: number;
  /** Wallet balance in ISK. */
  balance: number;
  updatedAt: string;
}

interface WalletDbRow {
  character_id: number;
  balance: number;
  updated_at: string;
}

function toRow(row: WalletDbRow): CharacterWalletRow {
  return {
    characterId: row.character_id,
    balance: row.balance,
    updatedAt: row.updated_at,
  };
}

export function upsertCharacterWallet(characterId: number, balance: number): void {
  getDb()
    .prepare(
      `INSERT INTO character_wallet (character_id, balance, updated_at)
       VALUES (@characterId, @balance, datetime('now'))
       ON CONFLICT(character_id) DO UPDATE SET
         balance = excluded.balance,
         updated_at = excluded.updated_at`,
    )
    .run({ characterId, balance });
}

/** Wallet rows for every character that has synced a balance. */
export function listCharacterWallets(): CharacterWalletRow[] {
  const rows = getDb()
    .prepare('SELECT character_id, balance, updated_at FROM character_wallet')
    .all() as WalletDbRow[];
  return rows.map(toRow);
}

export function getCharacterWalletRow(characterId: number): CharacterWalletRow | null {
  const row = getDb()
    .prepare(
      `SELECT character_id, balance, updated_at
       FROM character_wallet WHERE character_id = ?`,
    )
    .get(characterId) as WalletDbRow | undefined;
  return row ? toRow(row) : null;
}
