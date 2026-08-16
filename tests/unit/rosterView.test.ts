import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RosterEntry } from '@shared/types';
import {
  applyPinnedOrder,
  cloneJumpRemainingMs,
  DEFAULT_COLUMN_VISIBILITY,
  fatigueRemainingMs,
  filterRoster,
  loadColumnVisibility,
  NO_ROSTER_FILTERS,
  queueRemainingMs,
  saveColumnVisibility,
  sortRoster,
  summarizeRoster,
} from '@renderer/lib/rosterView';

function entry(overrides: {
  id: number;
  name: string;
  accountId?: number | null;
  accountLabel?: string | null;
  totalSp?: number;
  refreshedAt?: string | null;
  systemName?: string | null;
  shipTypeName?: string | null;
  jumpFatigue?: RosterEntry['jumpFatigue'];
  cloneJump?: RosterEntry['cloneJump'];
  walletBalance?: number | null;
  training?: Partial<RosterEntry['training']>;
  queueLength?: number;
  queueEndDate?: string | null;
}): RosterEntry {
  return {
    character: {
      id: overrides.id,
      name: overrides.name,
      corpId: null,
      allianceId: null,
      accountId: overrides.accountId ?? null,
      addedAt: '2026-01-01T00:00:00Z',
      refreshedAt: overrides.refreshedAt ?? null,
    },
    accountLabel: overrides.accountLabel ?? null,
    totalSp: overrides.totalSp ?? 0,
    queueLength: overrides.queueLength ?? 0,
    queueEndDate: overrides.queueEndDate ?? null,
    systemName: overrides.systemName ?? null,
    shipTypeName: overrides.shipTypeName ?? null,
    jumpFatigue: overrides.jumpFatigue ?? null,
    cloneJump: overrides.cloneJump ?? null,
    walletBalance: overrides.walletBalance ?? null,
    training: {
      isTraining: false,
      currentSkillTypeId: null,
      currentSkillName: null,
      currentFinishLevel: null,
      finishDate: null,
      ...overrides.training,
    },
  };
}

const alice = entry({
  id: 1,
  name: 'Alice',
  accountId: 10,
  accountLabel: 'Main',
  totalSp: 50_000_000,
  walletBalance: 1_500_000_000,
  refreshedAt: '2026-07-10T00:00:00Z',
  systemName: 'Jita',
  shipTypeName: 'Loki',
  training: {
    isTraining: true,
    currentSkillName: 'Gunnery',
    currentFinishLevel: 5,
    finishDate: '2026-07-20T00:00:00Z',
  },
});
const bob = entry({
  id: 2,
  name: 'Bob',
  accountId: 11,
  accountLabel: 'Alt Farm',
  totalSp: 5_000_000,
  walletBalance: 500_000_000,
  refreshedAt: '2026-07-11T00:00:00Z',
  systemName: 'Amarr',
  shipTypeName: 'Ibis',
});
const carol = entry({
  id: 3,
  name: 'Carol',
  totalSp: 12_000_000,
  // Never synced — no location or ship.
  training: {
    isTraining: true,
    currentSkillName: 'Mining Barge',
    currentFinishLevel: 4,
    finishDate: '2026-07-14T00:00:00Z',
  },
});
const roster = [alice, bob, carol];

describe('filterRoster', () => {
  it('passes everything through with no filters', () => {
    expect(filterRoster(roster, NO_ROSTER_FILTERS)).toEqual(roster);
  });

  it('matches character name case-insensitively', () => {
    expect(filterRoster(roster, { ...NO_ROSTER_FILTERS, search: 'ali' })).toEqual([alice]);
  });

  it('matches account label and training skill name', () => {
    expect(filterRoster(roster, { ...NO_ROSTER_FILTERS, search: 'alt farm' })).toEqual([bob]);
    expect(filterRoster(roster, { ...NO_ROSTER_FILTERS, search: 'mining' })).toEqual([carol]);
  });

  it('matches system name and ship type', () => {
    expect(filterRoster(roster, { ...NO_ROSTER_FILTERS, search: 'jita' })).toEqual([alice]);
    expect(filterRoster(roster, { ...NO_ROSTER_FILTERS, search: 'ibis' })).toEqual([bob]);
  });

  it('filters idle and training characters', () => {
    expect(filterRoster(roster, { ...NO_ROSTER_FILTERS, training: 'idle' })).toEqual([bob]);
    expect(filterRoster(roster, { ...NO_ROSTER_FILTERS, training: 'training' })).toEqual([
      alice,
      carol,
    ]);
  });

  it('filters by account, including unassigned', () => {
    expect(filterRoster(roster, { ...NO_ROSTER_FILTERS, account: 10 })).toEqual([alice]);
    expect(filterRoster(roster, { ...NO_ROSTER_FILTERS, account: 'unassigned' })).toEqual([carol]);
  });

  it('combines filters', () => {
    expect(filterRoster(roster, { search: 'bob', account: 10, training: 'all' })).toEqual([]);
  });
});

describe('sortRoster', () => {
  it('sorts by name in both directions', () => {
    expect(sortRoster(roster, { key: 'name', dir: 'asc' }).map((e) => e.character.name)).toEqual([
      'Alice',
      'Bob',
      'Carol',
    ]);
    expect(sortRoster(roster, { key: 'name', dir: 'desc' }).map((e) => e.character.name)).toEqual([
      'Carol',
      'Bob',
      'Alice',
    ]);
  });

  it('sorts by SP', () => {
    expect(sortRoster(roster, { key: 'sp', dir: 'desc' }).map((e) => e.character.id)).toEqual([
      1, 3, 2,
    ]);
  });

  it('sorts by training skill name with idle characters last', () => {
    // Gunnery (alice=1), Mining Barge (carol=3), then idle Bob (2).
    expect(sortRoster(roster, { key: 'training', dir: 'asc' }).map((e) => e.character.id)).toEqual([
      1, 3, 2,
    ]);
  });

  it('sorts by time left in queue with idle characters last', () => {
    expect(sortRoster(roster, { key: 'timeleft', dir: 'asc' }).map((e) => e.character.id)).toEqual([
      3, 1, 2,
    ]);
  });

  it('sorts by location with never-synced characters last', () => {
    // Amarr (bob=2), Jita (alice=1), then carol (3) with no system.
    expect(sortRoster(roster, { key: 'location', dir: 'asc' }).map((e) => e.character.id)).toEqual([
      2, 1, 3,
    ]);
    // Direction flips the located pair but unsynced stays last.
    expect(sortRoster(roster, { key: 'location', dir: 'desc' }).map((e) => e.character.id)).toEqual(
      [1, 2, 3],
    );
  });

  it('sorts by ship with no-ship characters last', () => {
    // Ibis (bob=2), Loki (alice=1), then carol (3) with no ship.
    expect(sortRoster(roster, { key: 'ship', dir: 'asc' }).map((e) => e.character.id)).toEqual([
      2, 1, 3,
    ]);
  });

  it('groups unassigned characters at the end when sorting by account', () => {
    const sorted = sortRoster(roster, { key: 'account', dir: 'asc' });
    expect(sorted.map((e) => e.character.id)).toEqual([2, 1, 3]);
    // Direction flips assigned accounts but unassigned stays last.
    const reversed = sortRoster(roster, { key: 'account', dir: 'desc' });
    expect(reversed.map((e) => e.character.id)).toEqual([1, 2, 3]);
  });

  it('sorts never-synced characters first ascending by last sync', () => {
    expect(sortRoster(roster, { key: 'sync', dir: 'asc' }).map((e) => e.character.id)).toEqual([
      3, 1, 2,
    ]);
  });

  it('sorts by tag names with untagged characters last', () => {
    // Alice: Cyno; Carol: Fax — Bob has no tags and stays last both ways.
    const tagNames = new Map([
      [1, 'Cyno'],
      [3, 'Fax'],
    ]);
    expect(
      sortRoster(roster, { key: 'tags', dir: 'asc' }, tagNames).map((e) => e.character.id),
    ).toEqual([1, 3, 2]);
    expect(
      sortRoster(roster, { key: 'tags', dir: 'desc' }, tagNames).map((e) => e.character.id),
    ).toEqual([3, 1, 2]);
  });

  it('treats every character as untagged when no tag lookup is provided', () => {
    // Falls through to the name tiebreak.
    expect(sortRoster(roster, { key: 'tags', dir: 'asc' }).map((e) => e.character.name)).toEqual([
      'Alice',
      'Bob',
      'Carol',
    ]);
  });

  it('does not mutate its input', () => {
    const input = [...roster];
    sortRoster(input, { key: 'sp', dir: 'desc' });
    expect(input).toEqual(roster);
  });
});

describe('queueRemainingMs', () => {
  const now = Date.parse('2026-07-14T00:00:00Z');

  it('returns null for an empty queue', () => {
    expect(queueRemainingMs(entry({ id: 1, name: 'A' }), now)).toBeNull();
  });

  it('returns null for a paused queue (EVE clears the dates)', () => {
    const e = entry({ id: 1, name: 'A', queueLength: 4, queueEndDate: null });
    expect(queueRemainingMs(e, now)).toBeNull();
  });

  it('returns null for a queue that already ran dry', () => {
    const e = entry({ id: 1, name: 'A', queueLength: 2, queueEndDate: '2026-07-13T00:00:00Z' });
    expect(queueRemainingMs(e, now)).toBeNull();
  });

  it('returns the millis until the last queued skill finishes', () => {
    const e = entry({ id: 1, name: 'A', queueLength: 3, queueEndDate: '2026-07-14T01:00:00Z' });
    expect(queueRemainingMs(e, now)).toBe(3_600_000);
  });

  it('measures the whole queue, not just the skill training now', () => {
    // Current skill ends in an hour but four more skills follow.
    const e = entry({
      id: 1,
      name: 'A',
      queueLength: 5,
      queueEndDate: '2026-07-24T00:00:00Z',
      training: { isTraining: true, finishDate: '2026-07-14T01:00:00Z' },
    });
    expect(queueRemainingMs(e, now)).toBe(10 * 24 * 3_600_000);
  });
});

describe('sortRoster by queue', () => {
  // Far-future/past dates keep the assertion independent of the real clock.
  const long = entry({ id: 1, name: 'Long', queueLength: 8, queueEndDate: '3000-01-01T00:00:00Z' });
  const short = entry({ id: 2, name: 'Short', queueLength: 1, queueEndDate: '2999-01-01T00:00:00Z' });
  const paused = entry({ id: 3, name: 'Paused', queueLength: 3, queueEndDate: null });
  const empty = entry({ id: 4, name: 'Empty' });
  const pool = [long, empty, short, paused];

  it('orders soonest-to-run-dry first, with nothing left to run last', () => {
    expect(sortRoster(pool, { key: 'queue', dir: 'asc' }).map((e) => e.character.id)).toEqual([
      2, 1, 4, 3,
    ]);
  });

  it('flips queued order but keeps empty and paused queues last', () => {
    // The queued pair reverses; the two without a remaining time stay last,
    // their name tiebreak flipping with direction (Paused before Empty).
    expect(sortRoster(pool, { key: 'queue', dir: 'desc' }).map((e) => e.character.id)).toEqual([
      1, 2, 3, 4,
    ]);
  });
});

describe('fatigueRemainingMs', () => {
  const now = Date.parse('2026-07-14T00:00:00Z');

  it('returns null when fatigue data is unknown', () => {
    expect(fatigueRemainingMs(entry({ id: 1, name: 'A' }), now)).toBeNull();
  });

  it('returns null for a synced character carrying no fatigue', () => {
    expect(
      fatigueRemainingMs(entry({ id: 1, name: 'A', jumpFatigue: { expireDate: null } }), now),
    ).toBeNull();
  });

  it('returns null when the expiry is already in the past', () => {
    const e = entry({ id: 1, name: 'A', jumpFatigue: { expireDate: '2026-07-13T00:00:00Z' } });
    expect(fatigueRemainingMs(e, now)).toBeNull();
  });

  it('returns the remaining millis for an active fatigue timer', () => {
    const e = entry({ id: 1, name: 'A', jumpFatigue: { expireDate: '2026-07-14T01:00:00Z' } });
    expect(fatigueRemainingMs(e, now)).toBe(3_600_000);
  });
});

describe('sortRoster by fatigue', () => {
  // Far-future/past dates keep the assertion independent of the real clock.
  const heavy = entry({
    id: 1,
    name: 'Heavy',
    jumpFatigue: { expireDate: '3000-01-01T00:00:00Z' },
  });
  const light = entry({
    id: 2,
    name: 'Light',
    jumpFatigue: { expireDate: '2999-01-01T00:00:00Z' },
  });
  const cleared = entry({
    id: 3,
    name: 'Cleared',
    jumpFatigue: { expireDate: '2000-01-01T00:00:00Z' },
  });
  const unknown = entry({ id: 4, name: 'Unknown' });
  const pool = [heavy, unknown, light, cleared];

  it('orders soonest-to-clear first, non-fatigued last', () => {
    expect(sortRoster(pool, { key: 'fatigue', dir: 'asc' }).map((e) => e.character.id)).toEqual([
      2, 1, 3, 4,
    ]);
  });

  it('flips fatigued order but keeps non-fatigued last when descending', () => {
    // Fatigued pair reverses (1 before 2); the two non-fatigued stay last, their
    // name tiebreak flipping with direction (Unknown before Cleared).
    expect(sortRoster(pool, { key: 'fatigue', dir: 'desc' }).map((e) => e.character.id)).toEqual([
      1, 2, 4, 3,
    ]);
  });
});

describe('cloneJumpRemainingMs', () => {
  const now = Date.parse('2026-07-14T00:00:00Z');

  it('returns null when clone data has never synced', () => {
    expect(cloneJumpRemainingMs(entry({ id: 1, name: 'A' }), now)).toBeNull();
  });

  it('returns 0 for a synced character that has never clone-jumped', () => {
    expect(
      cloneJumpRemainingMs(entry({ id: 1, name: 'A', cloneJump: { nextJumpAt: null } }), now),
    ).toBe(0);
  });

  it('returns 0 when the cooldown has already elapsed', () => {
    const e = entry({ id: 1, name: 'A', cloneJump: { nextJumpAt: '2026-07-13T00:00:00Z' } });
    expect(cloneJumpRemainingMs(e, now)).toBe(0);
  });

  it('returns the remaining millis of an active cooldown', () => {
    const e = entry({ id: 1, name: 'A', cloneJump: { nextJumpAt: '2026-07-14T01:00:00Z' } });
    expect(cloneJumpRemainingMs(e, now)).toBe(3_600_000);
  });
});

describe('sortRoster by clone jump', () => {
  // Far-future/past dates keep the assertion independent of the real clock.
  const cooling = entry({
    id: 1,
    name: 'Cooling',
    cloneJump: { nextJumpAt: '3000-01-01T00:00:00Z' },
  });
  const soon = entry({
    id: 2,
    name: 'Soon',
    cloneJump: { nextJumpAt: '2999-01-01T00:00:00Z' },
  });
  const ready = entry({ id: 3, name: 'Ready', cloneJump: { nextJumpAt: null } });
  const unknown = entry({ id: 4, name: 'Unknown' });
  const pool = [cooling, unknown, soon, ready];

  it('orders ready first, then soonest-to-ready, unknown last', () => {
    expect(sortRoster(pool, { key: 'clonejump', dir: 'asc' }).map((e) => e.character.id)).toEqual([
      3, 2, 1, 4,
    ]);
  });

  it('keeps unknown clone data last when descending', () => {
    expect(sortRoster(pool, { key: 'clonejump', dir: 'desc' }).map((e) => e.character.id)).toEqual([
      1, 2, 3, 4,
    ]);
  });
});

describe('sortRoster by wallet', () => {
  const rich = entry({ id: 1, name: 'Rich', walletBalance: 5_000_000_000 });
  const poor = entry({ id: 2, name: 'Poor', walletBalance: 12_000 });
  const unsynced = entry({ id: 3, name: 'Unsynced' });
  const pool = [poor, unsynced, rich];

  it('orders by balance with unsynced wallets last both ways', () => {
    expect(sortRoster(pool, { key: 'wallet', dir: 'desc' }).map((e) => e.character.id)).toEqual([
      1, 2, 3,
    ]);
    expect(sortRoster(pool, { key: 'wallet', dir: 'asc' }).map((e) => e.character.id)).toEqual([
      2, 1, 3,
    ]);
  });
});

describe('applyPinnedOrder', () => {
  it('reorders fresh entries to the captured id order', () => {
    expect(applyPinnedOrder(roster, [3, 1, 2]).map((e) => e.character.id)).toEqual([3, 1, 2]);
  });

  it('keeps a pinned row even when its data changed', () => {
    // Carol got assigned to an account — under an "unassigned" filter or an
    // account sort she would move, but the pin holds her position.
    const assigned = entry({ id: 3, name: 'Carol', accountId: 10, accountLabel: 'Main' });
    const reloaded = [alice, bob, assigned];
    expect(applyPinnedOrder(reloaded, [2, 3, 1]).map((e) => e.character.id)).toEqual([2, 3, 1]);
    expect(applyPinnedOrder(reloaded, [2, 3, 1])[1]).toBe(assigned);
  });

  it('drops pinned ids that no longer exist', () => {
    expect(applyPinnedOrder([alice, carol], [2, 3, 1]).map((e) => e.character.id)).toEqual([3, 1]);
  });

  it('leaves out entries not present in the pin', () => {
    expect(applyPinnedOrder(roster, [2]).map((e) => e.character.id)).toEqual([2]);
  });
});

describe('summarizeRoster', () => {
  it('counts training, idle, total SP, and combined wallet', () => {
    expect(summarizeRoster(roster)).toEqual({
      total: 3,
      training: 2,
      idle: 1,
      totalSp: 67_000_000,
      // Carol never synced a wallet, so only Alice + Bob count.
      totalWallet: 2_000_000_000,
    });
  });

  it('handles an empty roster', () => {
    expect(summarizeRoster([])).toEqual({
      total: 0,
      training: 0,
      idle: 0,
      totalSp: 0,
      totalWallet: 0,
    });
  });
});

describe('column visibility persistence', () => {
  // Minimal in-memory localStorage stub (the unit env is 'node').
  const store = new Map<string, string>();
  const stub = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };

  beforeEach(() => {
    store.clear();
    (globalThis as { localStorage?: unknown }).localStorage = stub;
  });

  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it('returns all-visible defaults when nothing is stored', () => {
    expect(loadColumnVisibility()).toEqual(DEFAULT_COLUMN_VISIBILITY);
  });

  it('returns defaults when localStorage is unavailable', () => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
    expect(loadColumnVisibility()).toEqual(DEFAULT_COLUMN_VISIBILITY);
  });

  it('returns defaults when the stored value is corrupt', () => {
    store.set('mco.roster.columns', '{not json');
    expect(loadColumnVisibility()).toEqual(DEFAULT_COLUMN_VISIBILITY);
  });

  it('round-trips saved visibility', () => {
    const saved = { ...DEFAULT_COLUMN_VISIBILITY, sp: false, sync: false };
    saveColumnVisibility(saved);
    expect(loadColumnVisibility()).toEqual(saved);
  });

  it('merges a partial stored object over the defaults', () => {
    // Only "sp" persisted (e.g. from an older release) — the rest default to visible.
    store.set('mco.roster.columns', JSON.stringify({ sp: false }));
    expect(loadColumnVisibility()).toEqual({ ...DEFAULT_COLUMN_VISIBILITY, sp: false });
  });
});
