/**
 * Grouping and filtering for the plan creator's ship browser — the same shape
 * as the skill browser next to it (`lib/planDraft.ts`), over hulls instead of
 * skills. Pure: the catalogue arrives whole and every interaction is local.
 */

import type { ShipInfo } from '@shared/types';

export interface ShipGroup {
  groupId: number;
  /** The SDE ship group: "Frigate", "Heavy Assault Cruiser", "Marauder"… */
  name: string;
  ships: ShipInfo[];
}

/** The catalogue bucketed by SDE ship group, groups and hulls alphabetical. */
export function groupShips(catalog: readonly ShipInfo[]): ShipGroup[] {
  const byGroup = new Map<number, ShipInfo[]>();
  for (const ship of catalog) {
    if (ship.groupId === null) continue;
    const list = byGroup.get(ship.groupId) ?? [];
    list.push(ship);
    byGroup.set(ship.groupId, list);
  }

  return [...byGroup]
    .map(([groupId, ships]) => ({
      groupId,
      name: ships[0]!.groupName ?? `Group ${groupId}`,
      ships: [...ships].sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Groups (and within them, hulls) matching a search. A group name that matches
 * keeps all of its hulls, so "marauder" answers with the four of them.
 */
export function filterShipGroups(groups: readonly ShipGroup[], query: string): ShipGroup[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return [...groups];

  const matches: ShipGroup[] = [];
  for (const group of groups) {
    if (group.name.toLowerCase().includes(needle)) {
      matches.push(group);
      continue;
    }
    const ships = group.ships.filter((ship) => ship.name.toLowerCase().includes(needle));
    if (ships.length > 0) matches.push({ ...group, ships });
  }
  return matches;
}
