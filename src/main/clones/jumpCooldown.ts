/**
 * Clone-jump cooldown math. Dependency-free so unit tests need no Electron/DB.
 *
 * A clone jump is allowed every 24 hours, reduced by 1 hour per level of the
 * Infomorph Synchronizing skill (19h at V).
 */

/** EVE type id of the Infomorph Synchronizing skill. */
export const INFOMORPH_SYNCHRONIZING_TYPE_ID = 33399;

const BASE_COOLDOWN_HOURS = 24;
const MAX_SKILL_LEVEL = 5;

/**
 * When the character can next clone-jump, as an ISO timestamp (possibly in the
 * past, meaning the jump is available now). Null when the character has never
 * clone-jumped — no cooldown exists at all.
 */
export function nextCloneJumpDate(
  lastCloneJumpDate: string | null,
  infomorphSynchronizingLevel: number,
): string | null {
  if (!lastCloneJumpDate) return null;
  const last = new Date(lastCloneJumpDate).getTime();
  if (Number.isNaN(last)) return null;
  const level = Math.min(MAX_SKILL_LEVEL, Math.max(0, infomorphSynchronizingLevel));
  return new Date(last + (BASE_COOLDOWN_HOURS - level) * 3_600_000).toISOString();
}
