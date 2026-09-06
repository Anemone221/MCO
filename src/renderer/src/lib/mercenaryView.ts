import type {
  MercenaryDenEntry,
  MercenaryDenStatus,
  MercenaryMeter,
  MercenaryOperationStatus,
} from '@shared/types';

/**
 * Table logic for the Mercenary Dens page — filtering, sorting and the words
 * each state is shown as. Pure, so it unit-tests without React.
 */

export type MercenarySortKey =
  | 'attention'
  | 'character'
  | 'location'
  | 'status'
  | 'development'
  | 'anarchy'
  | 'infomorphs'
  | 'operations'
  | 'timer';

export interface MercenarySort {
  key: MercenarySortKey;
  dir: 'asc' | 'desc';
}

/**
 * Default: whatever needs doing, first.
 *
 * The main process already sorts the board this way; re-stating it here is
 * what lets a user click back to it after sorting by something else.
 */
export const DEFAULT_MERCENARY_SORT: MercenarySort = { key: 'attention', dir: 'desc' };

/** How each den state reads on the board. */
export function denStatusLabel(status: MercenaryDenStatus): string {
  switch (status) {
    case 'running':
      return 'Running';
    case 'reinforced':
      return 'Reinforced';
    case 'paused':
      return 'Paused';
    case 'disabled':
      return 'Disabled';
    case 'unknown':
      return 'Unknown';
  }
}

/**
 * Chip modifier per state.
 *
 * Running is the routine case and gets the neutral chip, not a green one — on
 * a roster this size most dens are running, and colouring the majority makes
 * the exceptions harder to spot, not easier. Reinforced borrows the timer
 * blue used for jump fatigue, because it is the same kind of thing: a clock
 * someone else started.
 */
export function denStatusChip(status: MercenaryDenStatus): string {
  switch (status) {
    case 'reinforced':
      return 'chip chip--fatigue';
    case 'disabled':
      return 'chip chip--danger';
    case 'paused':
      return 'chip chip--warn';
    default:
      return 'chip chip--idle';
  }
}

export function operationStatusLabel(status: MercenaryOperationStatus): string {
  switch (status) {
    case 'available':
      return 'Available';
    case 'started':
      return 'Started';
    case 'completed':
      return 'Completed';
    case 'expired':
      return 'Expired';
    case 'removed':
      return 'Removed';
    case 'unknown':
      return 'Unknown';
  }
}

export function operationStatusChip(status: MercenaryOperationStatus): string {
  switch (status) {
    case 'available':
      return 'chip chip--ok';
    case 'started':
      return 'chip chip--fatigue';
    default:
      return 'chip chip--idle';
  }
}

/**
 * A meter as "L2 · 45%", or "—" when nothing is known.
 *
 * Level and amount are shown together because either alone misleads: the level
 * is what has effect in game, the amount is how close the next one is.
 */
export function formatMeter(meter: MercenaryMeter): string {
  if (meter.level === null && meter.amount === null) return '—';
  if (meter.level === null) return `${meter.amount}%`;
  if (meter.amount === null) return `L${meter.level}`;
  return `L${meter.level} · ${meter.amount}%`;
}

/** A den's address, as much of it as has resolved. */
export function denLocation(den: MercenaryDenEntry): string {
  if (den.planetName !== null) return den.planetName;
  if (den.systemName !== null) return `${den.systemName} · planet ${den.planetId}`;
  return `Planet ${den.planetId}`;
}

/** Free-text filter over everything a row shows as words. */
export function filterDens(dens: MercenaryDenEntry[], search: string): MercenaryDenEntry[] {
  const needle = search.trim().toLowerCase();
  if (!needle) return dens;
  return dens.filter((den) =>
    [
      den.characterName,
      den.accountLabel ?? '',
      den.planetName ?? '',
      den.systemName ?? '',
      den.regionName ?? '',
      den.typeName ?? '',
      den.skyhookCorporationName ?? '',
      denStatusLabel(den.status),
      // Dungeon names, so "which of my dens is offering an Infomorph run"
      // is answerable from the one search box.
      ...den.operations.map((op) => op.dungeonName ?? ''),
    ]
      .join('\n')
      .toLowerCase()
      .includes(needle),
  );
}

/**
 * How the status column orders when sorted: by urgency, not alphabetically.
 * Sorting states by their English name would put "Disabled" above "Running"
 * for a reason no one can see.
 */
const STATUS_ORDER: Record<MercenaryDenStatus, number> = {
  reinforced: 4,
  disabled: 3,
  paused: 2,
  unknown: 1,
  running: 0,
};

function sortValue(den: MercenaryDenEntry, key: MercenarySortKey): string | number {
  switch (key) {
    case 'attention':
      return den.attention;
    case 'character':
      return den.characterName.toLowerCase();
    case 'location':
      return denLocation(den).toLowerCase();
    case 'status':
      return STATUS_ORDER[den.status];
    case 'development':
      // A null meter sorts below Level 0, which is a real reading.
      return den.development.level ?? -1;
    case 'anarchy':
      return den.anarchy.level ?? -1;
    case 'infomorphs':
      return den.infomorphs ?? -1;
    case 'operations':
      return den.openOperations;
    case 'timer':
      // Dens with no timer sort last in either direction — "no deadline" is
      // not "a deadline in 1970".
      return den.reinforcementEnd === null ? Infinity : Date.parse(den.reinforcementEnd);
  }
}

export function sortDens(dens: MercenaryDenEntry[], sort: MercenarySort): MercenaryDenEntry[] {
  const direction = sort.dir === 'asc' ? 1 : -1;
  return [...dens].sort((a, b) => {
    const left = sortValue(a, sort.key);
    const right = sortValue(b, sort.key);
    if (left !== right) {
      const compared =
        typeof left === 'string' && typeof right === 'string'
          ? left.localeCompare(right)
          : Number(left) - Number(right);
      return compared * direction;
    }
    // Ties keep the board's own order: urgent first, then by character, so a
    // re-render never reshuffles rows that compare equal.
    return b.attention - a.attention || a.characterName.localeCompare(b.characterName);
  });
}

/** Names read A→Z; everything that measures something reads biggest-first. */
export function nextMercenarySort(sort: MercenarySort, key: MercenarySortKey): MercenarySort {
  if (sort.key === key) return { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' };
  return { key, dir: key === 'character' || key === 'location' ? 'asc' : 'desc' };
}
