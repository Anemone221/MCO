import type { CharacterSyncState } from '@shared/types';

/**
 * Classify one character's sync state for the Settings page, from data the
 * caller already has. Pure so it unit-tests without Electron or a DB.
 *
 * Sync is cache-driven: a character is "due" once its ESI skills cache entry
 * (the `Expires` header) has lapsed, and the hourly sweep picks it up then —
 * so "due" is routine, not an error.
 */
export function classifyCharacterSync(input: {
  /** characters.refreshed_at — null when the character has never fully synced. */
  refreshedAt: string | null;
  /** Expires timestamp of the cached ESI skills response, or null when uncached. */
  cacheExpiresAt: string | null;
  /** SSO has rejected the character's refresh token. */
  tokenInvalid: boolean;
  /** Injectable clock for tests; defaults to now. */
  nowMs?: number;
}): CharacterSyncState {
  if (input.tokenInvalid) return 'login-expired';
  if (input.refreshedAt === null) return 'never-synced';
  const expires = input.cacheExpiresAt ? new Date(input.cacheExpiresAt).getTime() : NaN;
  const now = input.nowMs ?? Date.now();
  if (!Number.isNaN(expires) && expires > now) return 'ok';
  return 'due';
}
