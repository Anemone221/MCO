import { safeStorage } from 'electron';
import { getToken, listTokenScopes, saveToken, updateAccessToken } from '../db/repositories/tokens';
import { UserFacingError } from '../errors';
import { decodeJwtPayload, scopesFromPayload } from './jwt';

function assertEncryptionAvailable(): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new UserFacingError(
      'OS-level encryption is unavailable; refresh tokens cannot be stored securely.',
    );
  }
}

/** Encrypt and persist a character's refresh token. */
export function persistRefreshToken(characterId: number, refreshToken: string, scopes: string): void {
  assertEncryptionAvailable();
  const encrypted = safeStorage.encryptString(refreshToken);
  saveToken({ characterId, refreshTokenEncrypted: encrypted, scopes });
}

/** Decrypt and return a character's stored refresh token, or null if absent. */
export function readRefreshToken(characterId: number): string | null {
  const stored = getToken(characterId);
  if (!stored) return null;
  assertEncryptionAvailable();
  return safeStorage.decryptString(stored.refreshTokenEncrypted);
}

/** Cache the most recent access token (a short-lived JWT) for a character. */
export function cacheAccessToken(
  characterId: number,
  accessToken: string,
  expiresAt: Date,
): void {
  updateAccessToken(characterId, accessToken, expiresAt.toISOString());
}

/** Return a cached access token if it is still valid for at least `skewMs`. */
export function getValidCachedAccessToken(characterId: number, skewMs = 60_000): string | null {
  const stored = getToken(characterId);
  if (!stored?.accessToken || !stored.accessExpiresAt) return null;
  const expiresAt = new Date(stored.accessExpiresAt).getTime();
  if (Number.isNaN(expiresAt) || expiresAt - Date.now() < skewMs) return null;
  return stored.accessToken;
}

/**
 * The decoded scope list per character, remembered against the token row it
 * came from. Live tracking asks for scopes on every tick and page builders ask
 * once per character, so without this a JWT is decoded 90+ times a minute; a
 * row only changes on login or refresh (every ~20 minutes), and a changed
 * access token or scope string is a miss, so the memo can never go stale.
 */
const scopeMemo = new Map<number, { accessToken: string | null; recorded: string; scopes: string[] }>();

function scopesFor(characterId: number, accessToken: string | null, recorded: string): string[] {
  const memo = scopeMemo.get(characterId);
  if (memo && memo.accessToken === accessToken && memo.recorded === recorded) return memo.scopes;

  let scopes: string[] | null = null;
  if (accessToken) {
    try {
      const decoded = scopesFromPayload(decodeJwtPayload(accessToken));
      if (decoded.length > 0) scopes = decoded;
    } catch {
      // fall through to the recorded scope list
    }
  }
  scopes ??= recorded.split(' ').filter((s) => s.length > 0);
  scopeMemo.set(characterId, { accessToken, recorded, scopes });
  return scopes;
}

/**
 * Scopes actually granted to a character's token. Prefers the `scp` claim of
 * the last-seen access token (the source of truth for the token family, even
 * once expired) over the stored scope list recorded at login.
 *
 * Decoding without re-verifying is safe here: this token's signature was
 * checked in `esi-oauth.ts` before it was ever written to the row, so the only
 * way to reach a forged `scp` is to edit the profile database by hand — at
 * which point the reward is that ESI answers the resulting call with a 403.
 */
export function grantedScopes(characterId: number): string[] {
  const stored = getToken(characterId);
  if (!stored) {
    scopeMemo.delete(characterId);
    return [];
  }
  return scopesFor(characterId, stored.accessToken, stored.scopes);
}

/**
 * {@link grantedScopes} for every character with a stored token, in one query.
 * A character with no token is absent — the same as holding no scope.
 */
export function grantedScopesByCharacter(): Map<number, string[]> {
  const result = new Map<number, string[]>();
  for (const row of listTokenScopes()) {
    result.set(row.characterId, scopesFor(row.characterId, row.accessToken, row.scopes));
  }
  return result;
}

/** True when the character's token was granted the given ESI scope. */
export function hasGrantedScope(characterId: number, scope: string): boolean {
  return grantedScopes(characterId).includes(scope);
}
