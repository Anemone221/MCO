import type { BlueprintCatalogEntry } from '@shared/types';

/**
 * Filtering, sorting and labelling for the blueprint checklist. Pure and
 * dependency-free (same shape as `rosterView.ts`) so the rules that decide what
 * a ~1,900-row table shows can be tested without rendering anything.
 */

/** SDE meta group ids → the tier names EVE shows in game. */
const META_GROUP_LABELS: Record<number, string> = {
  1: 'Tech I',
  2: 'Tech II',
  3: 'Storyline',
  4: 'Faction',
  5: 'Officer',
  6: 'Deadspace',
  14: 'Tech III',
  15: 'Abyssal',
  17: 'Premium',
  19: 'Limited Time',
  52: 'Structure Faction',
  53: 'Structure Tech II',
  54: 'Structure Tech I',
};

/**
 * Tier of the item a blueprint makes. Most Tech I items carry no metaGroupID at
 * all in the SDE, so "no tier" reads as Tech I rather than as unknown.
 */
export function metaGroupLabel(metaGroupId: number | null): string {
  if (metaGroupId === null) return 'Tech I';
  return META_GROUP_LABELS[metaGroupId] ?? `Meta ${metaGroupId}`;
}

export type OwnershipFilter = 'all' | 'owned' | 'missing';

export interface BlueprintFilters {
  search: string;
  category: string | 'all';
  ownership: OwnershipFilter;
  /**
   * Include blueprints that exist only as copies (no market group) — invention
   * output, faction BPC drops. Off by default: they can never be ticked off, so
   * leaving them in would put ~2,300 permanently-missing rows in the way.
   */
  includeCopyOnly: boolean;
  /**
   * Only a **blueprint original** ticks a row. On by default, because that is
   * what a BPO checklist means — a stack of copies is not a blueprint you own.
   * Turning it off ticks (and counts) blueprints you hold only as copies, for
   * the "what could I actually build right now" reading.
   */
  originalsOnly: boolean;
}

export const NO_BLUEPRINT_FILTERS: BlueprintFilters = {
  search: '',
  category: 'all',
  ownership: 'all',
  includeCopyOnly: false,
  originalsOnly: true,
};

/** Whether a blueprint counts as owned — the rule behind the check mark. */
export function isOwned(entry: BlueprintCatalogEntry, originalsOnly: boolean): boolean {
  if (entry.originals > 0) return true;
  return !originalsOnly && entry.copies > 0;
}

/**
 * The header's "N of M owned", counted over exactly the rows the toggles let
 * into the table — so the headline can never disagree with what is under it.
 * The search/category/ownership filters are deliberately *not* applied: a
 * denominator that moved while you typed would be unreadable.
 */
export function countOwned(
  entries: readonly BlueprintCatalogEntry[],
  filters: Pick<BlueprintFilters, 'includeCopyOnly' | 'originalsOnly'>,
): { owned: number; total: number } {
  const counted = filters.includeCopyOnly ? entries : entries.filter((e) => e.marketSeeded);
  return {
    owned: counted.filter((e) => isOwned(e, filters.originalsOnly)).length,
    total: counted.length,
  };
}

export type BlueprintSortKey =
  | 'name'
  | 'category'
  | 'group'
  | 'tech'
  | 'owned'
  | 'me'
  | 'te'
  | 'holders';

export interface BlueprintSort {
  key: BlueprintSortKey;
  dir: 'asc' | 'desc';
}

export const DEFAULT_BLUEPRINT_SORT: BlueprintSort = { key: 'name', dir: 'asc' };

/** Category names present in the catalog, for the filter dropdown. */
export function blueprintCategories(entries: readonly BlueprintCatalogEntry[]): string[] {
  const names = new Set<string>();
  for (const entry of entries) {
    if (entry.categoryName !== null) names.add(entry.categoryName);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

export function filterBlueprints(
  entries: readonly BlueprintCatalogEntry[],
  filters: BlueprintFilters,
): BlueprintCatalogEntry[] {
  const needle = filters.search.trim().toLowerCase();
  return entries.filter((entry) => {
    if (!filters.includeCopyOnly && !entry.marketSeeded) return false;
    // Owned/missing follows the same rule as the check mark, so the filter and
    // the tick can never contradict each other.
    const owned = isOwned(entry, filters.originalsOnly);
    if (filters.ownership === 'owned' && !owned) return false;
    if (filters.ownership === 'missing' && owned) return false;
    if (filters.category !== 'all' && entry.categoryName !== filters.category) return false;
    if (!needle) return true;
    return [
      entry.name,
      entry.categoryName ?? '',
      entry.groupName ?? '',
      ...entry.holders.map((h) => h.name),
    ]
      .join('\n')
      .toLowerCase()
      .includes(needle);
  });
}

function compare(a: BlueprintCatalogEntry, b: BlueprintCatalogEntry, key: BlueprintSortKey): number {
  switch (key) {
    case 'name':
      return a.name.localeCompare(b.name);
    case 'category':
      return (a.categoryName ?? '').localeCompare(b.categoryName ?? '');
    case 'group':
      return (a.groupName ?? '').localeCompare(b.groupName ?? '');
    case 'tech':
      return metaGroupLabel(a.metaGroupId).localeCompare(metaGroupLabel(b.metaGroupId));
    // Originals first, copies only as a tie-break: sorting by "Own" must not
    // float a pile of copies above a blueprint you actually hold.
    case 'owned':
      return a.originals - b.originals || a.copies - b.copies;
    // Unresearched and unowned both sort below any researched blueprint, so
    // "best ME first" puts the blueprints worth using at the top.
    case 'me':
      return (a.bestMaterialEfficiency ?? -1) - (b.bestMaterialEfficiency ?? -1);
    case 'te':
      return (a.bestTimeEfficiency ?? -1) - (b.bestTimeEfficiency ?? -1);
    case 'holders':
      return (a.holders[0]?.name ?? '').localeCompare(b.holders[0]?.name ?? '');
  }
}

/** Sort a copy of the entries; ties always fall back to name so order is stable. */
export function sortBlueprints(
  entries: readonly BlueprintCatalogEntry[],
  sort: BlueprintSort,
): BlueprintCatalogEntry[] {
  const factor = sort.dir === 'asc' ? 1 : -1;
  return [...entries].sort((a, b) => {
    const primary = compare(a, b, sort.key) * factor;
    return primary !== 0 ? primary : a.name.localeCompare(b.name);
  });
}
