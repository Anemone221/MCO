import type { LoginResult } from '@shared/types';
import { LoginCancelledError, startLogin } from '../auth/esi-oauth';
import { grantedScopes } from '../auth/token-store';
import { OPTIONAL_ESI_SCOPES } from '../config';
import { getCharacter } from '../db/repositories/characters';
import { syncCharacter } from './characterSync';

/**
 * The sign-ins the UI starts: adding a character, and re-authorizing one whose
 * login expired or whose token predates a scope.
 *
 * Both are `startLogin` plus a first sync. What differs from calling those two
 * directly is what a roster of 90+ needs from them: a cancelled sign-in is an
 * outcome rather than an error, and the sync can be left running so the next
 * SSO page opens straight away instead of after a dozen ESI requests.
 */

export interface LoginOptions {
  /**
   * Return as soon as the token is stored and let the first sync finish on its
   * own; `onSynced` fires when it has. For back-to-back sign-ins.
   */
  deferSync?: boolean;
  /** Called after a deferred sync ends, successful or not. */
  onSynced?: () => void;
}

async function signIn(extraScopes: readonly string[], options: LoginOptions): Promise<LoginResult> {
  let character;
  try {
    character = await startLogin(extraScopes);
  } catch (err) {
    if (err instanceof LoginCancelledError) return { outcome: 'cancelled' };
    throw err;
  }

  const firstSync = syncCharacter(character.id).catch((err: unknown) => {
    console.warn(
      `Initial sync after sign-in failed for character ${character.id}; the scheduler will retry:`,
      err,
    );
  });
  if (options.deferSync) void firstSync.then(() => options.onSynced?.());
  else await firstSync;

  return { outcome: 'signed-in', character };
}

/** Add a character (or refresh the login of one that is already tracked). */
export function addCharacter(options: LoginOptions = {}): Promise<LoginResult> {
  return signIn([], options);
}

/** Opt-in scopes a character's current token carries (see `OPTIONAL_ESI_SCOPES`). */
export function heldOptionalScopes(characterId: number): string[] {
  const granted = grantedScopes(characterId);
  return OPTIONAL_ESI_SCOPES.filter((scope) => granted.includes(scope));
}

/**
 * Run SSO again for a character MCO already tracks, to replace an expired
 * login or pick up scopes added since it signed in.
 *
 * A new login replaces the character's whole token family, so an opt-in scope
 * it holds (an alt corp's blueprint reader) has to be asked for again here or
 * it would be dropped by the very act of repairing the login.
 *
 * SSO, not MCO, decides which character signs in — the user picks it on CCP's
 * page — so the result may be a different character from the one asked for.
 * The caller compares ids; that sign-in is still a valid one and is kept.
 */
export async function reauthorizeCharacter(
  characterId: number,
  options: LoginOptions = {},
): Promise<LoginResult> {
  if (!getCharacter(characterId)) throw new Error(`Unknown character ${characterId}`);
  return signIn(heldOptionalScopes(characterId), options);
}
