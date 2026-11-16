import type { Database } from 'better-sqlite3';

/**
 * Keeps refresh tokens in step between the prod database and its dev copy.
 *
 * EVE SSO rotates the refresh token on every refresh, so a copied database is
 * a second holder of the same token family: whichever database refreshes first
 * leaves the other with a consumed token, and the next launch on that other
 * database would read every character as "login expired". Two rules prevent it:
 *
 * - a token stored while on the dev database is written through to prod
 *   ({@link mirrorTokenToProd}), so prod always holds the newest token — also
 *   for an installed build that knows nothing about dev databases;
 * - a dev launch that does not start from a fresh copy first takes prod's tokens
 *   ({@link adoptProdTokens}), since prod may have refreshed in between.
 *
 * Both only touch characters the other database already has: a character
 * added while on dev stays a dev-only character.
 */

/** Write a token just stored in dev through to the same character in prod. */
export function mirrorTokenToProd(
  prod: Database,
  input: { characterId: number; refreshTokenEncrypted: Buffer; scopes: string },
): void {
  prod
    .prepare(
      `UPDATE tokens
          SET refresh_token_encrypted = @refreshTokenEncrypted,
              scopes = @scopes,
              invalid_at = NULL
        WHERE character_id = @characterId`,
    )
    .run(input);
}

/** Replace dev's stored tokens with prod's, for every character both hold. Returns how many. */
export function adoptProdTokens(dev: Database, prod: Database): number {
  const rows = prod
    .prepare(
      `SELECT character_id, refresh_token_encrypted, scopes, access_token, access_expires_at, invalid_at
         FROM tokens`,
    )
    .all() as Array<Record<string, unknown>>;

  const update = dev.prepare(
    `UPDATE tokens
        SET refresh_token_encrypted = @refresh_token_encrypted,
            scopes = @scopes,
            access_token = @access_token,
            access_expires_at = @access_expires_at,
            invalid_at = @invalid_at
      WHERE character_id = @character_id`,
  );
  let adopted = 0;
  dev.transaction(() => {
    for (const row of rows) adopted += update.run(row).changes;
  })();
  return adopted;
}
