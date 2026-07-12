import { safeStorage } from 'electron';
import { getToken, saveToken, updateAccessToken } from '../db/repositories/tokens';

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
