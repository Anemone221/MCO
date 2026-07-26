import { safeStorage } from 'electron';
import { getToken, saveToken, updateAccessToken } from '../db/repositories/tokens';
import { decodeJwtPayload, scopesFromPayload } from './pkce';

function assertEncryptionAvailable(): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
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
 * Scopes actually granted to a character's token. Prefers the `scp` claim of
 * the last-seen access token (the source of truth for the token family, even
 * once expired) over the stored scope list recorded at login.
 */
export function grantedScopes(characterId: number): string[] {
  const stored = getToken(characterId);
  if (!stored) return [];
  if (stored.accessToken) {
    try {
      const scopes = scopesFromPayload(decodeJwtPayload(stored.accessToken));
      if (scopes.length > 0) return scopes;
    } catch {
      // fall through to the recorded scope list
    }
  }
  return stored.scopes.split(' ').filter((s) => s.length > 0);
}

/** True when the character's token was granted the given ESI scope. */
export function hasGrantedScope(characterId: number, scope: string): boolean {
  return grantedScopes(characterId).includes(scope);
}
