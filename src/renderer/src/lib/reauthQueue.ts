import type { CharacterSyncStatus } from '@shared/types';

/**
 * Which characters need to go through EVE SSO again, and what to do with each
 * sign-in the re-authorize run gets back. Pure, so the stepping rules are
 * unit-tested without a browser.
 */

export interface ReauthEntry {
  characterId: number;
  characterName: string;
  /** An expired login stops every sync; a missing scope only blanks the features that need it. */
  reason: 'login-expired' | 'scope-missing';
  missingScopes: string[];
}

/**
 * Every character whose login expired or whose token lacks a scope MCO now
 * asks for — expired logins first (those characters have stopped updating
 * altogether), then by name.
 */
export function reauthQueue(characters: readonly CharacterSyncStatus[]): ReauthEntry[] {
  const entries: ReauthEntry[] = [];
  for (const c of characters) {
    const expired = c.state === 'login-expired';
    if (!expired && c.missingScopes.length === 0) continue;
    entries.push({
      characterId: c.characterId,
      characterName: c.characterName,
      reason: expired ? 'login-expired' : 'scope-missing',
      missingScopes: c.missingScopes,
    });
  }
  return entries.sort(
    (a, b) =>
      Number(b.reason === 'login-expired') - Number(a.reason === 'login-expired') ||
      a.characterName.localeCompare(b.characterName),
  );
}

/** Why an entry is in the queue, for its row. */
export function reauthReason(entry: ReauthEntry): string {
  if (entry.reason === 'login-expired') return 'Login expired';
  const count = entry.missingScopes.length;
  return `${count} scope${count === 1 ? '' : 's'} missing`;
}

export interface ReauthStep {
  /** Who is still waiting, the next one to ask for first. */
  remaining: ReauthEntry[];
  /** What to tell the user about the sign-in that just came back, if anything. */
  note: string | null;
}

/**
 * Advance the run after a sign-in. `remaining[0]` is the character that was
 * asked for; `signedIn` is whoever CCP's page actually handed back.
 *
 * The user picks the character in the browser, so a mismatch is routine with
 * several characters on one account. That sign-in still repaired whoever it
 * was — they leave the queue if they were in it — and the character asked for
 * stays at the front for another go.
 */
export function afterSignIn(
  remaining: readonly ReauthEntry[],
  signedIn: { id: number; name: string },
): ReauthStep {
  const [asked, ...rest] = remaining;
  if (asked === undefined) return { remaining: [], note: null };
  if (signedIn.id === asked.characterId) return { remaining: rest, note: null };

  const wasQueued = rest.some((e) => e.characterId === signedIn.id);
  return {
    remaining: [asked, ...rest.filter((e) => e.characterId !== signedIn.id)],
    note:
      `That sign-in was for ${signedIn.name}` +
      (wasQueued ? ', which is now re-authorized. ' : ', not one waiting here. ') +
      `${asked.characterName} still needs its own — pick it on the EVE login page, or skip it.`,
  };
}

/** Drop the character at the front without signing it in. */
export function afterSkip(remaining: readonly ReauthEntry[]): ReauthStep {
  return { remaining: remaining.slice(1), note: null };
}
