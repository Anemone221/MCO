import type { CloneBoardEntry, ImplantInfo, JumpCloneEntry } from '@shared/types';

/** Display label for a clone's location, falling back to the raw id while unresolved. */
export function cloneLocationLabel(
  clone: Pick<JumpCloneEntry, 'locationId' | 'locationType' | 'locationName'>,
): string {
  if (clone.locationName) return clone.locationName;
  if (clone.locationType === 'structure' && clone.locationId !== null) {
    return `Structure ${clone.locationId}`;
  }
  if (clone.locationId !== null) return `Location ${clone.locationId}`;
  return 'Unknown location';
}

/** One clone (jump or medical) sitting at a location, flattened across characters. */
export interface CloneAtLocation {
  characterId: number;
  characterName: string;
  accountLabel: string | null;
  kind: 'jump' | 'medical';
  /** Jump clone id; null for the medical clone. */
  jumpCloneId: number | null;
  /** Player-assigned jump clone name, if any. */
  cloneName: string | null;
  locationId: number | null;
  location: string;
  implants: ImplantInfo[];
  critical: boolean;
  /** Character's next clone-jump availability (may be past = ready). */
  nextCloneJumpAt: string | null;
}

/**
 * Every clone on the board, one row per clone. Only characters whose clone
 * data synced cleanly contribute — the same rule the board uses to list them.
 */
export function allClones(board: CloneBoardEntry[]): CloneAtLocation[] {
  const rows: CloneAtLocation[] = [];
  for (const entry of board) {
    if (entry.status !== 'ok' || entry.updatedAt === null) continue;
    const base = {
      characterId: entry.characterId,
      characterName: entry.characterName,
      accountLabel: entry.accountLabel,
      nextCloneJumpAt: entry.nextCloneJumpAt,
    };
    for (const clone of entry.clones) {
      rows.push({
        ...base,
        kind: 'jump',
        jumpCloneId: clone.jumpCloneId,
        cloneName: clone.name,
        locationId: clone.locationId,
        location: cloneLocationLabel(clone),
        implants: clone.implants,
        critical: clone.critical,
      });
    }
    if (entry.medicalClone) {
      rows.push({
        ...base,
        kind: 'medical',
        jumpCloneId: null,
        cloneName: null,
        locationId: entry.medicalClone.locationId,
        location: cloneLocationLabel(entry.medicalClone),
        implants: [],
        critical: false,
      });
    }
  }
  return rows;
}

/** Distinct clone locations with how many clones sit there, busiest first. */
export function cloneLocations(clones: CloneAtLocation[]): { location: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const c of clones) counts.set(c.location, (counts.get(c.location) ?? 0) + 1);
  return [...counts.entries()]
    .map(([location, count]) => ({ location, count }))
    .sort((a, b) => b.count - a.count || a.location.localeCompare(b.location));
}

/**
 * Clones whose location matches the query (case-insensitive substring), so a
 * system name ("Jita") finds every station/structure in it. Sorted by
 * location, then character name, jump clones before the medical clone.
 */
export function clonesAtLocation(clones: CloneAtLocation[], query: string): CloneAtLocation[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  return clones
    .filter((c) => c.location.toLowerCase().includes(needle))
    .sort(
      (a, b) =>
        a.location.localeCompare(b.location) ||
        a.characterName.localeCompare(b.characterName) ||
        (a.kind === b.kind ? 0 : a.kind === 'jump' ? -1 : 1),
    );
}
