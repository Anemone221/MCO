import type { EsiDataStatus } from '@shared/types';

/** Required scopes that are not in the granted set. */
export function missingScopes(
  granted: readonly string[],
  required: readonly string[],
): string[] {
  return required.filter((scope) => !granted.includes(scope));
}

/**
 * Classify why a character's data for an ESI-backed feature may be absent.
 * Feature-agnostic: callers pass the feature's own required-scope check result
 * and whether that feature's data has ever synced for the character.
 */
export function classifyEsiDataStatus(input: {
  /** SSO has rejected the character's refresh token. */
  tokenInvalid: boolean;
  /** Required scopes the token lacks. */
  missingScopes: readonly string[];
  /** The feature's data has synced at least once. */
  hasSynced: boolean;
}): EsiDataStatus {
  if (input.tokenInvalid) return 'login-expired';
  if (input.missingScopes.length > 0) return 'scope-missing';
  if (!input.hasSynced) return 'pending';
  return 'ok';
}
