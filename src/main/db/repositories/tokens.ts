import { getDb } from '../index';

export interface StoredToken {
  characterId: number;
  refreshTokenEncrypted: Buffer;
  scopes: string;
  accessToken: string | null;
  accessExpiresAt: string | null;
}

interface TokenRow {
  character_id: number;
  refresh_token_encrypted: Buffer;
  scopes: string;
  access_token: string | null;
  access_expires_at: string | null;
}

export function saveToken(input: {
  characterId: number;
  refreshTokenEncrypted: Buffer;
  scopes: string;
}): void {
  getDb()
    .prepare(
      `INSERT INTO tokens (character_id, refresh_token_encrypted, scopes)
       VALUES (@characterId, @refreshTokenEncrypted, @scopes)
       ON CONFLICT(character_id) DO UPDATE SET
         refresh_token_encrypted = excluded.refresh_token_encrypted,
         scopes = excluded.scopes`,
    )
    .run(input);
}

export function getToken(characterId: number): StoredToken | null {
  const row = getDb()
    .prepare('SELECT * FROM tokens WHERE character_id = ?')
    .get(characterId) as TokenRow | undefined;
  if (!row) return null;
  return {
    characterId: row.character_id,
    refreshTokenEncrypted: row.refresh_token_encrypted,
    scopes: row.scopes,
    accessToken: row.access_token,
    accessExpiresAt: row.access_expires_at,
  };
}

export function updateAccessToken(
  characterId: number,
  accessToken: string,
  accessExpiresAt: string,
): void {
  getDb()
    .prepare('UPDATE tokens SET access_token = ?, access_expires_at = ? WHERE character_id = ?')
    .run(accessToken, accessExpiresAt, characterId);
}
