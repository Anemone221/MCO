import type { Tag } from '@shared/types';

/** 'all' shows every character; a number narrows to characters with that tag. */
export type TagFilter = 'all' | number;

export const ALL_TAGS: TagFilter = 'all';

/**
 * Character ids that have the selected tag, or null when no tag is selected
 * ('all') or the selected tag no longer exists — null means "don't filter".
 */
export function memberIdSet(tags: Tag[], filter: TagFilter): Set<number> | null {
  if (filter === 'all') return null;
  const tag = tags.find((t) => t.id === filter);
  if (!tag) return null;
  return new Set(tag.characterIds);
}

/** Keep only entries whose characterId is in the set; pass everything through when null. */
export function filterByTag<T extends { characterId: number }>(
  entries: T[],
  ids: Set<number> | null,
): T[] {
  if (ids === null) return entries;
  return entries.filter((e) => ids.has(e.characterId));
}

/** Tags a given character holds, in name order — handy for rendering capability chips. */
export function tagsForCharacter(tags: Tag[], characterId: number): Tag[] {
  return tags.filter((t) => t.characterIds.includes(characterId));
}

/**
 * For each tag, how many of the given characters already hold it — powers the
 * "n/total" / "all" hints on the bulk section-tag control. Keyed by tag id.
 */
export function sectionTagCoverage(tags: Tag[], characterIds: number[]): Map<number, number> {
  const inSection = new Set(characterIds);
  const coverage = new Map<number, number>();
  for (const tag of tags) {
    let held = 0;
    for (const id of tag.characterIds) if (inSection.has(id)) held++;
    coverage.set(tag.id, held);
  }
  return coverage;
}
