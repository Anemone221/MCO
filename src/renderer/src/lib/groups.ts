import type { CharacterGroup } from '@shared/types';

/** 'all' shows every character; a number narrows to that group's members. */
export type GroupFilter = 'all' | number;

export const ALL_GROUPS: GroupFilter = 'all';

/**
 * Member character ids for the selected group, or null when no group is
 * selected ('all') or the selected group no longer exists — null means
 * "don't filter".
 */
export function memberIdSet(groups: CharacterGroup[], filter: GroupFilter): Set<number> | null {
  if (filter === 'all') return null;
  const group = groups.find((g) => g.id === filter);
  if (!group) return null;
  return new Set(group.characterIds);
}

/** Keep only entries whose characterId is in the set; pass everything through when null. */
export function filterByGroup<T extends { characterId: number }>(
  entries: T[],
  ids: Set<number> | null,
): T[] {
  if (ids === null) return entries;
  return entries.filter((e) => ids.has(e.characterId));
}
