import type { BlueprintCatalogEntry, BlueprintHolder, BlueprintTotals } from '@shared/types';

/**
 * Rolling every held blueprint up against the SDE's blueprint universe.
 * Dependency-free on purpose: no DB, no ESI, no Electron — the counting rules
 * below are the whole feature, and they are worth testing directly.
 */

/** ESI's marker for a blueprint original. Anything else is a copy. */
export const ORIGINAL_QUANTITY = -1;

/** A blueprint the SDE says exists, before ownership is known. */
export interface CatalogInput {
  typeId: number;
  name: string;
  productTypeId: number | null;
  groupName: string | null;
  categoryName: string | null;
  metaGroupId: number | null;
  marketSeeded: boolean;
  activity: string;
}

/** A blueprint someone actually holds. */
export interface HoldingInput {
  /** ESI's unique id for this specific blueprint item. */
  itemId: number;
  typeId: number;
  /** -1 original, -2 single copy, positive = a stack of that many copies. */
  quantity: number;
  materialEfficiency: number;
  timeEfficiency: number;
  holderKind: 'character' | 'corporation';
  holderId: number;
  holderName: string;
}

export interface OwnershipResult {
  entries: BlueprintCatalogEntry[];
  totals: BlueprintTotals;
  /** Originals held per holder, keyed `kind:id` — feeds the coverage strip. */
  originalsByHolder: Map<string, number>;
}

export function holderKey(kind: 'character' | 'corporation', id: number): string {
  return `${kind}:${id}`;
}

function isOriginal(quantity: number): boolean {
  return quantity === ORIGINAL_QUANTITY;
}

/** How many copies a non-original row represents: -2 is one, a stack is its size. */
function copyCount(quantity: number): number {
  return quantity > 0 ? quantity : 1;
}

function toActivity(activity: string): BlueprintCatalogEntry['activity'] {
  return activity === 'manufacturing' || activity === 'reaction' ? activity : 'other';
}

/**
 * Join held blueprints onto the catalog.
 *
 * Two rules do the real work:
 *
 * - **Only originals tick the checklist.** ESI reports copies through the same
 *   endpoint, and a hangar full of BPCs is not a BPO collection. Copies are
 *   still counted, as context on the row.
 * - **Items are deduped by `item_id`.** A blueprint moved from a character's
 *   hangar into the corp's sits in both tables until that character next syncs;
 *   without the dedupe it would count twice and could push a row past the
 *   number of originals that exist.
 *
 * Holdings whose type is not in the catalog (unpublished or removed blueprint
 * types — old POS arrays, say) are counted into `totals.untracked` rather than
 * invented as rows: the catalog is the SDE's word on what exists.
 */
export function buildOwnership(
  catalog: readonly CatalogInput[],
  holdings: readonly HoldingInput[],
): OwnershipResult {
  const byType = new Map<number, HoldingInput[]>();
  const seenItems = new Set<number>();
  const originalsByHolder = new Map<string, number>();

  for (const holding of holdings) {
    if (seenItems.has(holding.itemId)) continue;
    seenItems.add(holding.itemId);
    const list = byType.get(holding.typeId);
    if (list) list.push(holding);
    else byType.set(holding.typeId, [holding]);
  }

  const catalogTypeIds = new Set(catalog.map((c) => c.typeId));
  let untracked = 0;

  const entries: BlueprintCatalogEntry[] = catalog.map((item) => {
    const held = byType.get(item.typeId) ?? [];
    const originals = held.filter((h) => isOriginal(h.quantity));
    const holders: BlueprintHolder[] = originals
      .map((h) => ({
        kind: h.holderKind,
        id: h.holderId,
        name: h.holderName,
        materialEfficiency: h.materialEfficiency,
        timeEfficiency: h.timeEfficiency,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    for (const original of originals) {
      const key = holderKey(original.holderKind, original.holderId);
      originalsByHolder.set(key, (originalsByHolder.get(key) ?? 0) + 1);
    }

    return {
      typeId: item.typeId,
      name: item.name,
      productTypeId: item.productTypeId,
      groupName: item.groupName,
      categoryName: item.categoryName,
      metaGroupId: item.metaGroupId,
      marketSeeded: item.marketSeeded,
      activity: toActivity(item.activity),
      originals: originals.length,
      copies: held.filter((h) => !isOriginal(h.quantity)).reduce((sum, h) => sum + copyCount(h.quantity), 0),
      holders,
      bestMaterialEfficiency: bestOf(originals.map((h) => h.materialEfficiency)),
      bestTimeEfficiency: bestOf(originals.map((h) => h.timeEfficiency)),
    };
  });

  for (const [typeId, held] of byType) {
    if (catalogTypeIds.has(typeId)) continue;
    const originals = held.filter((h) => isOriginal(h.quantity));
    untracked += originals.length;
    for (const original of originals) {
      const key = holderKey(original.holderKind, original.holderId);
      originalsByHolder.set(key, (originalsByHolder.get(key) ?? 0) + 1);
    }
  }

  return {
    entries,
    totals: {
      seededTotal: entries.filter((e) => e.marketSeeded).length,
      allTotal: entries.length,
      untracked,
    },
    originalsByHolder,
  };
}

/** Highest research level among the given values; null when there are none. */
function bestOf(values: number[]): number | null {
  return values.length > 0 ? Math.max(...values) : null;
}
