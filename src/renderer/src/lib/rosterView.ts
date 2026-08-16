import type { RosterEntry } from '@shared/types';
import { summarizeQueue } from './groupView';

export type TrainingFilter = 'all' | 'training' | 'idle';

/** 'all', 'unassigned', or a specific account id. */
export type AccountFilter = 'all' | 'unassigned' | number;

export interface RosterFilters {
  search: string;
  account: AccountFilter;
  training: TrainingFilter;
}

export const NO_ROSTER_FILTERS: RosterFilters = { search: '', account: 'all', training: 'all' };

export type RosterSortKey =
  | 'name'
  | 'account'
  | 'tags'
  | 'location'
  | 'ship'
  | 'training'
  | 'timeleft'
  | 'queue'
  | 'fatigue'
  | 'clonejump'
  | 'sp'
  | 'wallet'
  | 'sync';

export interface RosterSort {
  key: RosterSortKey;
  dir: 'asc' | 'desc';
}

/**
 * Toggleable roster columns — every column except the always-on Character column
 * (`name`) and the actions column. Keys line up with {@link RosterSortKey}.
 */
export type RosterColumnKey =
  | 'account'
  | 'tags'
  | 'location'
  | 'ship'
  | 'training'
  | 'timeleft'
  | 'queue'
  | 'fatigue'
  | 'clonejump'
  | 'sp'
  | 'wallet'
  | 'sync';

export const ROSTER_COLUMNS: { key: RosterColumnKey; label: string; numeric?: boolean }[] = [
  { key: 'account', label: 'Account' },
  { key: 'tags', label: 'Tags' },
  { key: 'location', label: 'Location' },
  { key: 'ship', label: 'Ship' },
  { key: 'training', label: 'Training' },
  { key: 'timeleft', label: 'Time left' },
  { key: 'queue', label: 'Queue left' },
  { key: 'fatigue', label: 'Jump fatigue' },
  { key: 'clonejump', label: 'Jump clone' },
  { key: 'sp', label: 'Total SP', numeric: true },
  { key: 'wallet', label: 'Wallet', numeric: true },
  { key: 'sync', label: 'Last sync' },
];

export type ColumnVisibility = Record<RosterColumnKey, boolean>;

/** Everything visible by default. */
export const DEFAULT_COLUMN_VISIBILITY: ColumnVisibility = {
  account: true,
  tags: true,
  location: true,
  ship: true,
  training: true,
  timeleft: true,
  queue: true,
  fatigue: true,
  clonejump: true,
  sp: true,
  wallet: true,
  sync: true,
};

const COLUMN_STORAGE_KEY = 'mco.roster.columns';

/**
 * Read persisted column visibility, merging stored values over the defaults so
 * columns added in a later release default to visible. Tolerates missing or
 * corrupt storage by falling back to {@link DEFAULT_COLUMN_VISIBILITY}.
 */
export function loadColumnVisibility(): ColumnVisibility {
  try {
    const raw = localStorage.getItem(COLUMN_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_COLUMN_VISIBILITY };
    const stored = JSON.parse(raw) as Partial<Record<RosterColumnKey, unknown>>;
    const merged = { ...DEFAULT_COLUMN_VISIBILITY };
    for (const { key } of ROSTER_COLUMNS) {
      if (typeof stored[key] === 'boolean') merged[key] = stored[key];
    }
    return merged;
  } catch {
    return { ...DEFAULT_COLUMN_VISIBILITY };
  }
}

export function saveColumnVisibility(visibility: ColumnVisibility): void {
  try {
    localStorage.setItem(COLUMN_STORAGE_KEY, JSON.stringify(visibility));
  } catch {
    // Persistence is best-effort; ignore quota/availability failures.
  }
}

/** Search matches character name, account label, or the skill currently training. */
export function filterRoster(entries: RosterEntry[], filters: RosterFilters): RosterEntry[] {
  const needle = filters.search.trim().toLowerCase();
  return entries.filter((entry) => {
    if (filters.training === 'training' && !entry.training.isTraining) return false;
    if (filters.training === 'idle' && entry.training.isTraining) return false;

    if (filters.account === 'unassigned' && entry.character.accountId !== null) return false;
    if (typeof filters.account === 'number' && entry.character.accountId !== filters.account) {
      return false;
    }

    if (needle) {
      const haystack = [
        entry.character.name,
        entry.accountLabel ?? '',
        entry.training.currentSkillName ?? '',
        entry.systemName ?? '',
        entry.shipTypeName ?? '',
      ]
        .join('\n')
        .toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return true;
  });
}

/** Millis until the training queue finishes; idle characters sort past everyone. */
function trainingRank(entry: RosterEntry): number {
  if (!entry.training.isTraining || !entry.training.finishDate) return Number.MAX_SAFE_INTEGER;
  const t = new Date(entry.training.finishDate).getTime();
  return Number.isNaN(t) ? Number.MAX_SAFE_INTEGER : t;
}

function syncRank(entry: RosterEntry): number {
  if (!entry.character.refreshedAt) return Number.MIN_SAFE_INTEGER;
  const t = new Date(entry.character.refreshedAt).getTime();
  return Number.isNaN(t) ? Number.MIN_SAFE_INTEGER : t;
}

/**
 * Millis until jump fatigue clears, or `null` if the character isn't currently
 * fatigued (no fatigue data, no expiry, or the expiry is already in the past).
 */
export function fatigueRemainingMs(entry: RosterEntry, now = Date.now()): number | null {
  const iso = entry.jumpFatigue?.expireDate;
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t) || t <= now) return null;
  return t - now;
}

/**
 * Millis until the character's whole skill queue runs dry, or `null` when there
 * is no time left to run down: an empty queue, a paused one (EVE clears queue
 * dates while training is paused), or one whose last entry already finished.
 */
export function queueRemainingMs(entry: RosterEntry, now = Date.now()): number | null {
  const queue = summarizeQueue(entry.queueLength, entry.queueEndDate, now);
  if (queue.state !== 'active') return null;
  return new Date(queue.endDate).getTime() - now;
}

/**
 * Millis until the character can clone-jump again: 0 when the jump is
 * available right now (never jumped, or the cooldown has elapsed), `null`
 * when clone data has never synced so availability is unknown.
 */
export function cloneJumpRemainingMs(entry: RosterEntry, now = Date.now()): number | null {
  if (!entry.cloneJump) return null;
  const iso = entry.cloneJump.nextJumpAt;
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, t - now);
}

/**
 * Tag data lives outside RosterEntry, so sorting by the Tags column takes a
 * lookup of characterId → the character's tag names joined in display order.
 */
export function sortRoster(
  entries: RosterEntry[],
  sort: RosterSort,
  tagNames?: Map<number, string>,
): RosterEntry[] {
  const flip = sort.dir === 'desc' ? -1 : 1;
  const byName = (a: RosterEntry, b: RosterEntry) =>
    a.character.name.localeCompare(b.character.name);

  return [...entries].sort((a, b) => {
    let cmp: number;
    switch (sort.key) {
      case 'name':
        cmp = byName(a, b);
        break;
      case 'account':
        // Unassigned characters group at the end regardless of direction.
        if ((a.accountLabel === null) !== (b.accountLabel === null)) {
          return a.accountLabel === null ? 1 : -1;
        }
        cmp = (a.accountLabel ?? '').localeCompare(b.accountLabel ?? '');
        break;
      case 'tags': {
        // Untagged characters group at the end regardless of direction.
        const at = tagNames?.get(a.character.id) ?? '';
        const bt = tagNames?.get(b.character.id) ?? '';
        if ((at === '') !== (bt === '')) return at === '' ? 1 : -1;
        cmp = at.localeCompare(bt);
        break;
      }
      case 'location':
        // Never-synced characters (no system) group at the end.
        if ((a.systemName === null) !== (b.systemName === null)) {
          return a.systemName === null ? 1 : -1;
        }
        cmp = (a.systemName ?? '').localeCompare(b.systemName ?? '');
        break;
      case 'ship':
        if ((a.shipTypeName === null) !== (b.shipTypeName === null)) {
          return a.shipTypeName === null ? 1 : -1;
        }
        cmp = (a.shipTypeName ?? '').localeCompare(b.shipTypeName ?? '');
        break;
      case 'training':
        // Idle characters (no skill) group at the end; otherwise sort by skill name.
        if (a.training.isTraining !== b.training.isTraining) {
          return a.training.isTraining ? -1 : 1;
        }
        cmp = (a.training.currentSkillName ?? '').localeCompare(b.training.currentSkillName ?? '');
        break;
      case 'timeleft':
        cmp = trainingRank(a) - trainingRank(b);
        break;
      case 'queue': {
        // Queues with nothing left to run (empty, paused, already finished)
        // group at the end; otherwise soonest-to-run-dry first.
        const aq = queueRemainingMs(a);
        const bq = queueRemainingMs(b);
        if ((aq === null) !== (bq === null)) return aq === null ? 1 : -1;
        cmp = (aq ?? 0) - (bq ?? 0);
        break;
      }
      case 'fatigue': {
        // Non-fatigued characters group at the end; otherwise soonest-to-clear first.
        const af = fatigueRemainingMs(a);
        const bf = fatigueRemainingMs(b);
        if ((af === null) !== (bf === null)) return af === null ? 1 : -1;
        cmp = (af ?? 0) - (bf ?? 0);
        break;
      }
      case 'clonejump': {
        // Unknown clone data groups at the end; otherwise ready-now first,
        // then soonest-to-ready.
        const ac = cloneJumpRemainingMs(a);
        const bc = cloneJumpRemainingMs(b);
        if ((ac === null) !== (bc === null)) return ac === null ? 1 : -1;
        cmp = (ac ?? 0) - (bc ?? 0);
        break;
      }
      case 'sp':
        cmp = a.totalSp - b.totalSp;
        break;
      case 'wallet':
        // Unsynced wallets group at the end regardless of direction.
        if ((a.walletBalance === null) !== (b.walletBalance === null)) {
          return a.walletBalance === null ? 1 : -1;
        }
        cmp = (a.walletBalance ?? 0) - (b.walletBalance ?? 0);
        break;
      case 'sync':
        cmp = syncRank(a) - syncRank(b);
        break;
    }
    if (cmp === 0) cmp = byName(a, b);
    return cmp * flip;
  });
}

/**
 * Rebuild a previously captured row order from fresh roster data. Used by the
 * Roster page to hold rows in place across an account assignment: re-sorting or
 * re-filtering the instant a row's account changes would shift the table under
 * the cursor mid-bulk-assignment. Ids that no longer exist are dropped; entries
 * not in `pinnedIds` (e.g. characters added meanwhile) are left out until the
 * pin is released.
 */
export function applyPinnedOrder(entries: RosterEntry[], pinnedIds: number[]): RosterEntry[] {
  const byId = new Map(entries.map((e) => [e.character.id, e]));
  const out: RosterEntry[] = [];
  for (const id of pinnedIds) {
    const entry = byId.get(id);
    if (entry) out.push(entry);
  }
  return out;
}

export interface RosterSummary {
  total: number;
  training: number;
  /** Characters with no active training — burning no SP. */
  idle: number;
  totalSp: number;
  /** Combined ISK across characters that have synced a wallet balance. */
  totalWallet: number;
}

export function summarizeRoster(entries: RosterEntry[]): RosterSummary {
  let training = 0;
  let totalSp = 0;
  let totalWallet = 0;
  for (const entry of entries) {
    if (entry.training.isTraining) training += 1;
    totalSp += entry.totalSp;
    // Skip never-synced wallets so the total reflects only known balances.
    if (entry.walletBalance !== null) totalWallet += entry.walletBalance;
  }
  return { total: entries.length, training, idle: entries.length - training, totalSp, totalWallet };
}
