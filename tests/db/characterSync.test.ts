import { describe, expect, it, vi } from 'vitest';
import { ESI_SCOPES, SCOPE_READ_BLUEPRINTS, SCOPE_READ_WALLET } from '@main/config';
import { getDb } from '@main/db';
import { listCharacterBlueprints } from '@main/db/repositories/blueprints';
import { getCharacter } from '@main/db/repositories/characters';
import { getJumpClones } from '@main/db/repositories/clones';
import { getCharacterWalletRow } from '@main/db/repositories/characterWallet';
import { getQueue, getTotalSp } from '@main/db/repositories/skills';
import { getInvalidTokenIds } from '@main/db/repositories/tokens';
import { readRefreshToken } from '@main/auth/token-store';
import {
  buildRoster,
  isCharacterDue,
  setSyncProgressListener,
  syncAllCharacters,
  syncCharacter,
  syncCharacters,
  syncDueCharacters,
} from '@main/services/characterSync';
import { buildSyncStatus } from '@main/services/settingsService';
import type { SyncProgress } from '@shared/types';
import { answerCharacter, seedCharacter, signAccessToken, useFakeEve } from './support/fakeEve';
import { useFreshProfile } from './support/profile';

const ALICE = 90000001;
const BOB = 90000002;

const count = (table: string, characterId: number): number =>
  (
    getDb().prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE character_id = ?`).get(characterId) as {
      n: number;
    }
  ).n;

describe('syncCharacter', () => {
  useFreshProfile();
  const eve = useFakeEve();

  it('stores every domain a full-scope character reports', async () => {
    seedCharacter({ characterId: ALICE, name: 'Alice' });
    answerCharacter(eve, ALICE, 'Alice');

    await syncCharacter(ALICE);

    const character = getCharacter(ALICE);
    expect(character).toMatchObject({ name: 'Alice', corpId: 98000001, allianceId: 99000001 });
    expect(character?.refreshedAt).not.toBeNull();

    expect(getTotalSp(ALICE)).toBe(1_280_000);
    expect(getQueue(ALICE).map((q) => [q.skillTypeId, q.finishLevel])).toEqual([
      [3328, 4],
      [3328, 5],
    ]);
    expect(getCharacterWalletRow(ALICE)?.balance).toBe(1_234_567.89);
    expect(getJumpClones(ALICE).map((c) => c.jumpCloneId)).toEqual([501]);
    expect(listCharacterBlueprints().map((b) => b.characterId)).toEqual([ALICE]);
    expect(count('character_location', ALICE)).toBe(1);
    expect(count('character_attributes', ALICE)).toBe(1);
    expect(count('character_mining_ledger', ALICE)).toBe(1);
    // Only the tracked ref_type is banked; the market escrow line is not.
    expect(count('character_wallet_journal', ALICE)).toBe(1);
  });

  it('asks ESI for nothing while every cached answer is still fresh', async () => {
    seedCharacter({ characterId: ALICE, name: 'Alice' });
    answerCharacter(eve, ALICE, 'Alice');

    await syncCharacter(ALICE);
    const afterFirst = eve.esiRequests.length;
    expect(afterFirst).toBeGreaterThan(10);
    expect(isCharacterDue(ALICE)).toBe(false);

    await syncCharacter(ALICE);
    expect(eve.esiRequests.length).toBe(afterFirst);
  });

  it('revalidates an expired answer with its ETag and keeps the stored body on a 304', async () => {
    seedCharacter({ characterId: ALICE, name: 'Alice' });
    answerCharacter(eve, ALICE, 'Alice');
    const seen: Array<string | null> = [];
    eve.esi(`/characters/${ALICE}/wallet`, ({ headers }) => {
      seen.push(headers.get('if-none-match'));
      return seen.length === 1
        ? { body: 500, etag: '"w1"', expiresIn: -1 }
        : { status: 304, expiresIn: 300 };
    });

    await syncCharacter(ALICE);
    await syncCharacter(ALICE);

    expect(seen).toEqual([null, '"w1"']);
    expect(getCharacterWalletRow(ALICE)?.balance).toBe(500);
  });

  it('skips the domains a token has no scope for, without a request', async () => {
    const scopes = ESI_SCOPES.filter((s) => s !== SCOPE_READ_WALLET && s !== SCOPE_READ_BLUEPRINTS);
    seedCharacter({ characterId: ALICE, name: 'Alice', scopes });
    answerCharacter(eve, ALICE, 'Alice');

    await syncCharacter(ALICE);

    expect(eve.count(`/characters/${ALICE}/wallet`)).toBe(0);
    expect(eve.count(`/characters/${ALICE}/wallet/journal?page=1`)).toBe(0);
    expect(eve.count(`/characters/${ALICE}/blueprints?page=1`)).toBe(0);
    expect(getCharacterWalletRow(ALICE)).toBeNull();
    // Everything it does have a scope for still synced.
    expect(getTotalSp(ALICE)).toBe(1_280_000);
    expect(getCharacter(ALICE)?.refreshedAt).not.toBeNull();

    const status = buildSyncStatus().characters[0];
    expect(status?.missingScopes.sort()).toEqual([SCOPE_READ_BLUEPRINTS, SCOPE_READ_WALLET].sort());
  });

  it('fails as a whole, storing nothing, when the skills cannot be read', async () => {
    seedCharacter({ characterId: ALICE, name: 'Alice' });
    answerCharacter(eve, ALICE, 'Alice');
    eve.esi(`/characters/${ALICE}/skillqueue`, { status: 403, body: { error: 'forbidden' } });

    await expect(syncCharacter(ALICE)).rejects.toThrow(/skillqueue/);

    // Skills arrived but the queue did not: neither is stored, and the
    // character stays un-refreshed so the next sweep retries it.
    expect(getTotalSp(ALICE)).toBe(0);
    expect(getCharacter(ALICE)?.refreshedAt).toBeNull();
    expect(eve.count(`/characters/${ALICE}/wallet`)).toBe(0);
  });

  it('carries on past a domain that fails when it is not the critical one', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    seedCharacter({ characterId: ALICE, name: 'Alice' });
    answerCharacter(eve, ALICE, 'Alice');
    eve.esi(`/characters/${ALICE}/wallet`, { status: 403, body: { error: 'forbidden' } });

    await syncCharacter(ALICE);

    expect(getCharacterWalletRow(ALICE)).toBeNull();
    expect(count('character_attributes', ALICE)).toBe(1);
    expect(getCharacter(ALICE)?.refreshedAt).not.toBeNull();
    expect(warn).toHaveBeenCalledWith(
      `Wallet sync failed for character ${ALICE}:`,
      expect.anything(),
    );
    warn.mockRestore();
  });

  it('keeps the stored blueprints when a later page of them fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    seedCharacter({ characterId: ALICE, name: 'Alice' });
    answerCharacter(eve, ALICE, 'Alice');
    const page = (itemId: number): unknown[] => [
      {
        item_id: itemId,
        type_id: 691,
        location_id: 60003760,
        location_flag: 'Hangar',
        quantity: -1,
        runs: -1,
        material_efficiency: 0,
        time_efficiency: 0,
      },
    ];
    // Short-lived, so the second sync asks again.
    eve.esi(`/characters/${ALICE}/blueprints?page=1`, { pages: 2, body: page(1), expiresIn: -1 });
    eve.esi(`/characters/${ALICE}/blueprints?page=2`, { pages: 2, body: page(2), expiresIn: -1 });
    await syncCharacter(ALICE);
    expect(listCharacterBlueprints().map((b) => b.itemId).sort()).toEqual([1, 2]);

    // Page 2 now refuses. Storing page 1 alone would make item 2 vanish.
    eve.esi(`/characters/${ALICE}/blueprints?page=2`, { status: 403, body: { error: 'nope' } });
    await syncCharacter(ALICE);

    expect(listCharacterBlueprints().map((b) => b.itemId).sort()).toEqual([1, 2]);
    warn.mockRestore();
  });

  it('refreshes an expired access token once for a whole sync, storing the rotated refresh token', async () => {
    seedCharacter({ characterId: ALICE, name: 'Alice', expiresIn: -60 });
    answerCharacter(eve, ALICE, 'Alice');
    eve.token((form) => ({
      body: {
        access_token: signAccessToken({ characterId: ALICE, name: 'Alice' }),
        refresh_token: `rotated-after-${form.get('refresh_token')}`,
        expires_in: 1200,
        token_type: 'Bearer',
      },
    }));

    await syncCharacter(ALICE);

    // Skills, queue and public data are fetched together; all three needed
    // a token and must have shared one exchange.
    expect(eve.tokenRequests).toHaveLength(1);
    expect(eve.tokenRequests[0]?.get('grant_type')).toBe('refresh_token');
    expect(eve.tokenRequests[0]?.get('refresh_token')).toBe(`refresh-${ALICE}-0`);
    expect(readRefreshToken(ALICE)).toBe(`rotated-after-refresh-${ALICE}-0`);
    expect(getCharacter(ALICE)?.refreshedAt).not.toBeNull();
  });

  it('marks the login expired when SSO rejects the refresh token, and not otherwise', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    seedCharacter({ characterId: ALICE, name: 'Alice', expiresIn: -60 });
    seedCharacter({ characterId: BOB, name: 'Bob', expiresIn: -60 });
    answerCharacter(eve, ALICE, 'Alice');
    answerCharacter(eve, BOB, 'Bob');
    eve.token((form) =>
      form.get('refresh_token') === `refresh-${ALICE}-0`
        ? { status: 400, body: { error: 'invalid_grant' } }
        : { status: 503, body: { error: 'temporarily_unavailable' } },
    );

    await expect(syncCharacter(ALICE)).rejects.toThrow();
    await expect(syncCharacter(BOB)).rejects.toThrow();

    // An outage at SSO is not the token's fault and must not deauthorize Bob.
    expect([...getInvalidTokenIds()]).toEqual([ALICE]);
    const states = new Map(buildSyncStatus().characters.map((c) => [c.characterId, c.state]));
    expect(states.get(ALICE)).toBe('login-expired');
    expect(states.get(BOB)).toBe('never-synced');
    warn.mockRestore();
  });
});

describe('multi-character sync', () => {
  useFreshProfile();
  const eve = useFakeEve();

  it('reports each character separately and keeps going past a failure', async () => {
    seedCharacter({ characterId: ALICE, name: 'Alice' });
    seedCharacter({ characterId: BOB, name: 'Bob' });
    answerCharacter(eve, ALICE, 'Alice');
    answerCharacter(eve, BOB, 'Bob');
    eve.esi(`/characters/${BOB}/skills`, { status: 403, body: { error: 'forbidden' } });

    const progress: SyncProgress[] = [];
    setSyncProgressListener((p) => progress.push(p));

    const results = await syncAllCharacters();

    expect(results.find((r) => r.characterId === ALICE)).toEqual({ characterId: ALICE, ok: true });
    expect(results.find((r) => r.characterId === BOB)).toMatchObject({ ok: false });
    expect(progress[0]).toEqual({ done: 0, total: 2 });
    expect(progress[progress.length - 1]).toEqual({ done: 2, total: 2 });
  });

  it('stops a fleet sync after the wave that found no network, leaving the rest due', async () => {
    const ids = Array.from({ length: 10 }, (_, i) => 90000100 + i);
    for (const id of ids) {
      seedCharacter({ characterId: id, name: `Pilot ${id}` });
      answerCharacter(eve, id, `Pilot ${id}`);
    }
    eve.offline(true);
    vi.useFakeTimers();
    try {
      const run = syncAllCharacters();
      // Enough for every retry sleep the first wave can schedule.
      await vi.advanceTimersByTimeAsync(60_000);
      const results = await run;

      expect(results).toHaveLength(10);
      const failed = results.filter((r) => !r.ok && !r.error?.startsWith('skipped'));
      const skipped = results.filter((r) => r.error?.startsWith('skipped: network'));
      // One wave of eight tried and failed; the two behind it were not sent.
      expect(failed).toHaveLength(8);
      expect(skipped).toHaveLength(2);
      for (const id of ids.slice(8)) expect(eve.count(`/characters/${id}/skills`)).toBe(0);
      for (const id of ids) expect(isCharacterDue(id)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('syncs only the characters whose skills cache has lapsed', async () => {
    seedCharacter({ characterId: ALICE, name: 'Alice' });
    seedCharacter({ characterId: BOB, name: 'Bob' });
    answerCharacter(eve, ALICE, 'Alice');
    answerCharacter(eve, BOB, 'Bob');
    await syncCharacter(ALICE);

    expect(isCharacterDue(ALICE)).toBe(false);
    expect(isCharacterDue(BOB)).toBe(true);

    const results = await syncDueCharacters();
    expect(results).toEqual([{ characterId: BOB, ok: true }]);
    expect(await syncDueCharacters()).toEqual([]);
  });

  it('syncs a chosen set of characters and nobody else', async () => {
    seedCharacter({ characterId: ALICE, name: 'Alice' });
    seedCharacter({ characterId: BOB, name: 'Bob' });
    answerCharacter(eve, ALICE, 'Alice');
    answerCharacter(eve, BOB, 'Bob');
    const progress: SyncProgress[] = [];
    setSyncProgressListener((p) => progress.push(p));

    // 12345 is not a tracked character: skipped, not an error.
    const results = await syncCharacters([BOB, 12345]);

    expect(results).toEqual([{ characterId: BOB, ok: true }]);
    expect(progress[progress.length - 1]).toEqual({ done: 1, total: 1 });
    expect(eve.count(`/characters/${ALICE}/skills`)).toBe(0);
    expect(await syncCharacters([])).toEqual([]);
  });

  it('builds the roster from what the sync stored', async () => {
    seedCharacter({ characterId: ALICE, name: 'Alice' });
    seedCharacter({ characterId: BOB, name: 'Bob' });
    answerCharacter(eve, ALICE, 'Alice');
    answerCharacter(eve, BOB, 'Bob');
    eve.esi(`/characters/${BOB}/skillqueue`, { body: [] });
    await syncAllCharacters();

    const roster = new Map(buildRoster().map((entry) => [entry.character.id, entry]));

    const alice = roster.get(ALICE)!;
    expect(alice.totalSp).toBe(1_280_000);
    expect(alice.training).toMatchObject({ isTraining: true, currentSkillTypeId: 3328, currentFinishLevel: 4 });
    expect(alice.queueLength).toBe(2);
    expect(alice.walletBalance).toBe(1_234_567.89);
    expect(alice.cloneJump).not.toBeNull();
    // No SDE imported in this profile: names are absent, not errors.
    expect(alice.systemName).toBeNull();

    const bob = roster.get(BOB)!;
    expect(bob.training.isTraining).toBe(false);
    expect(bob.queueLength).toBe(0);
    expect(bob.queueEndDate).toBeNull();
  });
});
