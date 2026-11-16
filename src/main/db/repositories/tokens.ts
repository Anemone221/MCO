import { mirrorTokenToProd } from '../devTokens';
import { getDb, getProdMirrorDb } from '../index';

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
         scopes = excluded.scopes,
         invalid_at = NULL`,
    )
    .run(input);

  // On the dev database, prod holds the same token family and SSO has just
  // retired the token prod has — hand it the new one (see `db/devTokens.ts`).
  try {
    const prod = getProdMirrorDb();
    if (prod) mirrorTokenToProd(prod, input);
  } catch (err) {
    console.error(
      `[db] could not write character ${input.characterId}'s refreshed login through to the ` +
        'production database; it will read "login expired" there:',
      err,
    );
  }
}

/** Record that a character's refresh token was rejected by SSO (expired/revoked). */
export function markTokenInvalid(characterId: number): void {
  getDb()
    .prepare("UPDATE tokens SET invalid_at = datetime('now') WHERE character_id = ?")
    .run(characterId);
}

/** Clear the invalid marker after a successful refresh. */
export function clearTokenInvalid(characterId: number): void {
  getDb()
    .prepare('UPDATE tokens SET invalid_at = NULL WHERE character_id = ?')
    .run(characterId);
}

/** Character ids whose refresh token has been rejected by SSO. */
export function getInvalidTokenIds(): Set<number> {
  const rows = getDb()
    .prepare('SELECT character_id FROM tokens WHERE invalid_at IS NOT NULL')
    .all() as Array<{ character_id: number }>;
  return new Set(rows.map((r) => r.character_id));
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

/** What decides each character's granted scopes, for every stored token in one query. */
export function listTokenScopes(): Array<{
  characterId: number;
  scopes: string;
  accessToken: string | null;
}> {
  const rows = getDb()
    .prepare('SELECT character_id, scopes, access_token FROM tokens')
    .all() as Array<{ character_id: number; scopes: string; access_token: string | null }>;
  return rows.map((r) => ({
    characterId: r.character_id,
    scopes: r.scopes,
    accessToken: r.access_token,
  }));
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
