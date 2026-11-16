import { describe, expect, it } from 'vitest';
import { getDb } from '@main/db';
import {
  assignAccount,
  assignAccountToCharacters,
  ensureCharacter,
  getCharacter,
  listCharacters,
  removeCharacter,
  touchRefreshed,
  upsertCharacter,
} from '@main/db/repositories/characters';
import { createAccount, listAccounts, removeAccount, setAccountOmega } from '@main/db/repositories/accounts';
import {
  addTagToCharacter,
  addTagToCharacters,
  createTag,
  listTags,
  listTagsForCharacter,
  removeTag,
  removeTagFromCharacter,
  removeTagFromCharacters,
} from '@main/db/repositories/tags';
import {
  addMember,
  addMembers,
  createGroup,
  listGroups,
  listGroupsForCharacter,
  removeGroup,
  removeMembers,
} from '@main/db/repositories/groups';
import {
  getActiveSkillLevels,
  getQueue,
  getTotalSp,
  replaceQueue,
  replaceSkills,
} from '@main/db/repositories/skills';
import {
  clearTokenInvalid,
  getInvalidTokenIds,
  getToken,
  markTokenInvalid,
  saveToken,
  updateAccessToken,
} from '@main/db/repositories/tokens';
import { getCached, isFresh, putCached } from '@main/db/repositories/esiCache';
import {
  createNotification,
  countUnread,
  dismissNotification,
  getNotification,
  listNotifications,
  markAllRead,
  pruneDismissedNotifications,
} from '@main/db/repositories/notifications';
import {
  listCharacterBlueprints,
  replaceCharacterBlueprints,
  type OwnedBlueprintRow,
} from '@main/db/repositories/blueprints';
import {
  sumWalletTotalsBetween,
  upsertJournalEntries,
} from '@main/db/repositories/characterWalletJournal';
import { getFlag, getSetting, setFlag, setSetting } from '@main/db/repositories/appSettings';
import { useFreshProfile } from './support/profile';

const ALICE = 90000001;
const BOB = 90000002;

function blueprint(itemId: number, over: Partial<OwnedBlueprintRow> = {}): OwnedBlueprintRow {
  return {
    itemId,
    typeId: 691,
    quantity: -1,
    runs: -1,
    materialEfficiency: 10,
    timeEfficiency: 20,
    locationId: 60003760,
    locationFlag: 'Hangar',
    ...over,
  };
}

describe('repositories', () => {
  useFreshProfile();

  describe('characters', () => {
    it('stores a character from a login without inventing a corporation', () => {
      ensureCharacter(ALICE, 'Alice');
      expect(getCharacter(ALICE)).toMatchObject({
        id: ALICE,
        name: 'Alice',
        corpId: null,
        allianceId: null,
        accountId: null,
        refreshedAt: null,
      });
    });

    it('keeps the corporation a sync recorded when the character signs in again', () => {
      // The login path only knows the name. Re-running SSO for a tracked
      // character must not blank what ESI's public data filled in.
      upsertCharacter({ id: ALICE, name: 'Alice', corpId: 98000001, allianceId: 99000001 });
      ensureCharacter(ALICE, 'Alice Renamed');
      expect(getCharacter(ALICE)).toMatchObject({
        name: 'Alice Renamed',
        corpId: 98000001,
        allianceId: 99000001,
      });
    });

    it('overwrites corporation and alliance from ESI public data', () => {
      upsertCharacter({ id: ALICE, name: 'Alice', corpId: 98000001, allianceId: 99000001 });
      upsertCharacter({ id: ALICE, name: 'Alice', corpId: 98000002 });
      expect(getCharacter(ALICE)).toMatchObject({ corpId: 98000002, allianceId: null });
    });

    it('keeps the account assignment and sync stamp across an upsert', () => {
      ensureCharacter(ALICE, 'Alice');
      const account = createAccount('Main');
      assignAccount(ALICE, account.id);
      touchRefreshed(ALICE);
      upsertCharacter({ id: ALICE, name: 'Alice', corpId: 98000001 });
      const stored = getCharacter(ALICE);
      expect(stored?.accountId).toBe(account.id);
      expect(stored?.refreshedAt).not.toBeNull();
    });

    it('moves many characters into an account in one go, and back out', () => {
      ensureCharacter(ALICE, 'Alice');
      ensureCharacter(BOB, 'Bob');
      const account = createAccount('Main');

      assignAccountToCharacters([ALICE, BOB], account.id);
      expect(listCharacters().map((c) => c.accountId)).toEqual([account.id, account.id]);

      assignAccountToCharacters([BOB], null);
      expect(getCharacter(ALICE)?.accountId).toBe(account.id);
      expect(getCharacter(BOB)?.accountId).toBeNull();
    });

    it('moves nobody when the account does not exist', () => {
      ensureCharacter(ALICE, 'Alice');
      ensureCharacter(BOB, 'Bob');
      expect(() => assignAccountToCharacters([ALICE, BOB], 999)).toThrow();
      expect(listCharacters().map((c) => c.accountId)).toEqual([null, null]);
    });

    it('lists characters by name', () => {
      ensureCharacter(BOB, 'Bob');
      ensureCharacter(ALICE, 'Alice');
      expect(listCharacters().map((c) => c.name)).toEqual(['Alice', 'Bob']);
    });

    it('takes everything keyed to a character with it when the character is removed', () => {
      ensureCharacter(ALICE, 'Alice');
      ensureCharacter(BOB, 'Bob');
      const tag = createTag('Cyno');
      const group = createGroup('WH defense');
      for (const id of [ALICE, BOB]) {
        saveToken({ characterId: id, refreshTokenEncrypted: Buffer.from('x'), scopes: 'a b' });
        replaceSkills(id, [{ skillTypeId: 3300, sp: 1000, trainedLevel: 1, activeLevel: 1 }]);
        replaceQueue(id, [
          { position: 0, skillTypeId: 3300, finishLevel: 2, startDate: null, finishDate: null },
        ]);
        replaceCharacterBlueprints(id, [blueprint(id)]);
        addTagToCharacter(tag.id, id);
        addMember(group.id, id);
        createNotification({
          kind: 'queue-drain',
          dedupeKey: `k-${id}`,
          characterId: id,
          title: 't',
          body: 'b',
        });
      }

      removeCharacter(ALICE);

      // Every table that points at a character, found from the schema itself
      // so a table added later is covered without touching this test.
      const db = getDb();
      const tables = (
        db
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
          .all() as Array<{ name: string }>
      )
        .map((t) => t.name)
        .filter((name) =>
          (db.pragma(`table_info(${name})`) as Array<{ name: string }>).some(
            (column) => column.name === 'character_id',
          ),
        );
      expect(tables.length).toBeGreaterThan(5);

      const leftovers = tables.filter((name) => {
        const row = db
          .prepare(`SELECT COUNT(*) AS n FROM ${name} WHERE character_id = ?`)
          .get(ALICE) as { n: number };
        return row.n > 0;
      });
      expect(leftovers).toEqual([]);

      // …and nothing of the other character went with it.
      expect(getToken(BOB)).not.toBeNull();
      expect(getTotalSp(BOB)).toBe(1000);
      expect(listTags()[0]?.characterIds).toEqual([BOB]);
      expect(listGroups()[0]?.characterIds).toEqual([BOB]);
    });
  });

  describe('accounts', () => {
    it('round-trips an account and its Omega flag', () => {
      const account = createAccount('Main', '#ff0000');
      setAccountOmega(account.id, true);
      expect(listAccounts()).toEqual([
        { id: account.id, label: 'Main', color: '#ff0000', isOmega: true },
      ]);
    });

    it('leaves its characters unassigned when an account is removed', () => {
      ensureCharacter(ALICE, 'Alice');
      const account = createAccount('Main');
      assignAccount(ALICE, account.id);
      removeAccount(account.id);
      expect(getCharacter(ALICE)).toMatchObject({ id: ALICE, accountId: null });
    });
  });

  describe('tags and groups', () => {
    it('attaches a tag to many characters at once, ignoring repeats', () => {
      ensureCharacter(ALICE, 'Alice');
      ensureCharacter(BOB, 'Bob');
      const tag = createTag('Fax');
      addTagToCharacter(tag.id, ALICE);
      addTagToCharacters(tag.id, [ALICE, BOB]);
      expect(listTags()[0]?.characterIds.sort()).toEqual([ALICE, BOB]);
      expect(listTagsForCharacter(BOB).map((t) => t.name)).toEqual(['Fax']);

      removeTagFromCharacter(tag.id, ALICE);
      expect(listTags()[0]?.characterIds).toEqual([BOB]);
    });

    it('detaches a tag from many characters at once', () => {
      ensureCharacter(ALICE, 'Alice');
      ensureCharacter(BOB, 'Bob');
      const cyno = createTag('Cyno');
      const fax = createTag('Fax');
      addTagToCharacters(cyno.id, [ALICE, BOB]);
      addTagToCharacters(fax.id, [ALICE, BOB]);

      // Bob twice, and an id that holds nothing: neither is an error.
      removeTagFromCharacters(cyno.id, [ALICE, BOB, BOB, 12345]);

      const byName = new Map(listTags().map((t) => [t.name, t.characterIds.sort()]));
      expect(byName.get('Cyno')).toEqual([]);
      expect(byName.get('Fax')).toEqual([ALICE, BOB]);
    });

    it('adds and removes group members in bulk, ignoring repeats', () => {
      ensureCharacter(ALICE, 'Alice');
      ensureCharacter(BOB, 'Bob');
      const group = createGroup('WH defense');
      addMember(group.id, ALICE);

      addMembers(group.id, [ALICE, BOB]);
      expect(listGroups()[0]?.characterIds.sort()).toEqual([ALICE, BOB]);

      removeMembers(group.id, [ALICE, 12345]);
      expect(listGroups()[0]?.characterIds).toEqual([BOB]);
    });

    it('adds nobody to a group when one of the characters does not exist', () => {
      ensureCharacter(ALICE, 'Alice');
      const group = createGroup('Fleet');
      // The foreign key rejects the unknown id; the transaction takes Alice back out.
      expect(() => addMembers(group.id, [ALICE, 12345])).toThrow();
      expect(listGroups()[0]?.characterIds).toEqual([]);
    });

    it('removes memberships, not characters, when a tag or group is removed', () => {
      ensureCharacter(ALICE, 'Alice');
      const tag = createTag('Cyno');
      const group = createGroup('Fleet');
      addTagToCharacter(tag.id, ALICE);
      addMember(group.id, ALICE);
      expect(listGroupsForCharacter(ALICE).map((g) => g.name)).toEqual(['Fleet']);

      removeTag(tag.id);
      removeGroup(group.id);
      expect(listTagsForCharacter(ALICE)).toEqual([]);
      expect(listGroupsForCharacter(ALICE)).toEqual([]);
      expect(getCharacter(ALICE)).not.toBeNull();
    });
  });

  describe('skills', () => {
    it('replaces the whole skill set and queue rather than merging', () => {
      ensureCharacter(ALICE, 'Alice');
      replaceSkills(ALICE, [
        { skillTypeId: 3300, sp: 1000, trainedLevel: 1, activeLevel: 1 },
        { skillTypeId: 3301, sp: 2000, trainedLevel: 2, activeLevel: 2 },
      ]);
      replaceQueue(ALICE, [
        { position: 1, skillTypeId: 3301, finishLevel: 4, startDate: null, finishDate: null },
        { position: 0, skillTypeId: 3301, finishLevel: 3, startDate: 'a', finishDate: 'b' },
      ]);
      expect(getTotalSp(ALICE)).toBe(3000);
      expect(getQueue(ALICE).map((q) => q.finishLevel)).toEqual([3, 4]);

      // An extracted skill and an emptied queue have to disappear.
      replaceSkills(ALICE, [{ skillTypeId: 3300, sp: 1500, trainedLevel: 1, activeLevel: 0 }]);
      replaceQueue(ALICE, []);
      expect(getTotalSp(ALICE)).toBe(1500);
      expect(getQueue(ALICE)).toEqual([]);
      expect(getActiveSkillLevels(3300).get(ALICE)).toBe(0);
    });
  });

  describe('tokens', () => {
    it('clears the expired marker when a new login is stored', () => {
      ensureCharacter(ALICE, 'Alice');
      saveToken({ characterId: ALICE, refreshTokenEncrypted: Buffer.from('one'), scopes: 'a' });
      updateAccessToken(ALICE, 'jwt', '2030-01-01T00:00:00.000Z');
      markTokenInvalid(ALICE);
      expect(getInvalidTokenIds().has(ALICE)).toBe(true);

      saveToken({ characterId: ALICE, refreshTokenEncrypted: Buffer.from('two'), scopes: 'a b' });
      expect(getInvalidTokenIds().has(ALICE)).toBe(false);
      const stored = getToken(ALICE);
      expect(stored?.scopes).toBe('a b');
      expect(Buffer.from(stored!.refreshTokenEncrypted).toString()).toBe('two');
      // The cached access token is a different column and is left alone.
      expect(stored?.accessToken).toBe('jwt');
    });

    it('sets and clears the expired marker on its own', () => {
      ensureCharacter(ALICE, 'Alice');
      saveToken({ characterId: ALICE, refreshTokenEncrypted: Buffer.from('one'), scopes: 'a' });
      markTokenInvalid(ALICE);
      clearTokenInvalid(ALICE);
      expect(getInvalidTokenIds().size).toBe(0);
    });
  });

  describe('ESI cache', () => {
    it('round-trips an entry, including its page count, and replaces it in place', () => {
      const url = 'https://esi.evetech.net/characters/1/blueprints?page=1';
      putCached({ url, etag: '"a"', expiresAt: '2000-01-01T00:00:00.000Z', body: '[1]', pages: 3 });
      expect(getCached(url)).toEqual({
        url,
        etag: '"a"',
        expiresAt: '2000-01-01T00:00:00.000Z',
        body: '[1]',
        pages: 3,
      });
      expect(isFresh(getCached(url))).toBe(false);

      const future = new Date(Date.now() + 60_000).toISOString();
      putCached({ url, etag: '"b"', expiresAt: future, body: '[2]', pages: null });
      expect(getCached(url)).toMatchObject({ etag: '"b"', body: '[2]', pages: null });
      expect(isFresh(getCached(url))).toBe(true);
      expect(getCached('https://esi.evetech.net/nothing')).toBeNull();
    });
  });

  describe('notifications', () => {
    const input = (dedupeKey: string) => ({
      kind: 'queue-drain',
      dedupeKey,
      characterId: null,
      title: 'Queue ending',
      body: 'Soon',
    });

    it('raises one row per occurrence, however often it is reported', () => {
      expect(createNotification(input('a'))).not.toBeNull();
      expect(createNotification(input('a'))).toBeNull();
      expect(listNotifications()).toHaveLength(1);
    });

    it('does not raise a dismissed occurrence again', () => {
      const first = createNotification(input('a'))!;
      dismissNotification(first.id);
      expect(listNotifications()).toEqual([]);
      expect(countUnread()).toBe(0);
      expect(createNotification(input('a'))).toBeNull();
      expect(getNotification(first.id)?.dismissedAt).not.toBeNull();
    });

    it('prunes only dismissed rows past the retention age', () => {
      const oldDismissed = createNotification(input('old-dismissed'))!;
      const oldListed = createNotification(input('old-listed'))!;
      const newDismissed = createNotification(input('new-dismissed'))!;
      dismissNotification(oldDismissed.id);
      dismissNotification(newDismissed.id);
      getDb()
        .prepare("UPDATE notifications SET created_at = datetime('now', '-40 days') WHERE id IN (?, ?)")
        .run(oldDismissed.id, oldListed.id);

      expect(pruneDismissedNotifications(30)).toBe(1);
      expect(getNotification(oldDismissed.id)).toBeNull();
      // Still listed: the user has not cleared it, however old it is.
      expect(getNotification(oldListed.id)).not.toBeNull();
      expect(getNotification(newDismissed.id)).not.toBeNull();
    });

    it('marks everything listed as read', () => {
      createNotification(input('a'));
      createNotification(input('b'));
      expect(countUnread()).toBe(2);
      markAllRead();
      expect(countUnread()).toBe(0);
    });
  });

  describe('blueprints', () => {
    it('replaces one character\'s blueprints without touching another\'s', () => {
      ensureCharacter(ALICE, 'Alice');
      ensureCharacter(BOB, 'Bob');
      replaceCharacterBlueprints(ALICE, [blueprint(1), blueprint(2)]);
      replaceCharacterBlueprints(BOB, [blueprint(3)]);
      replaceCharacterBlueprints(ALICE, [blueprint(2)]);
      expect(
        listCharacterBlueprints()
          .map((b) => [b.characterId, b.itemId])
          .sort(),
      ).toEqual([
        [ALICE, 2],
        [BOB, 3],
      ]);
    });

    it('moves a blueprint that changed hands instead of failing on its id', () => {
      // item_id is unique game-wide. If the receiver syncs before the giver,
      // the giver's stale row is still there when the item arrives.
      ensureCharacter(ALICE, 'Alice');
      ensureCharacter(BOB, 'Bob');
      replaceCharacterBlueprints(ALICE, [blueprint(1)]);
      replaceCharacterBlueprints(BOB, [blueprint(1)]);
      expect(listCharacterBlueprints().map((b) => [b.characterId, b.itemId])).toEqual([[BOB, 1]]);
    });
  });

  describe('wallet journal', () => {
    it('banks an entry once however many sweeps report it', () => {
      ensureCharacter(ALICE, 'Alice');
      const entry = {
        journalId: 7001,
        refType: 'bounty_prizes',
        amount: 250_000,
        tax: 25_000,
        firstPartyId: null,
        secondPartyId: null,
        occurredAt: '2026-11-10T12:00:00Z',
      };
      upsertJournalEntries(ALICE, [entry]);
      upsertJournalEntries(ALICE, [entry]);

      const totals = sumWalletTotalsBetween('2026-11-01T00:00:00Z', '2026-12-01T00:00:00Z');
      expect(totals.income.bountyIsk).toBe(250_000);
      expect(totals.taxIsk).toBe(25_000);
    });

    it('counts ISK moved between tracked characters as a transfer, not income', () => {
      ensureCharacter(ALICE, 'Alice');
      ensureCharacter(BOB, 'Bob');
      const base = { refType: 'player_donation', tax: 0, occurredAt: '2026-11-10T12:00:00Z' };
      // Bob → Alice (both tracked), and a stranger → Alice.
      upsertJournalEntries(ALICE, [
        { ...base, journalId: 1, amount: 100, firstPartyId: BOB, secondPartyId: ALICE },
        { ...base, journalId: 2, amount: 40, firstPartyId: 555, secondPartyId: ALICE },
      ]);
      upsertJournalEntries(BOB, [
        { ...base, journalId: 1, amount: -100, firstPartyId: BOB, secondPartyId: ALICE },
      ]);

      const totals = sumWalletTotalsBetween('2026-11-01T00:00:00Z', '2026-12-01T00:00:00Z');
      expect(totals.internalTransferIsk).toBe(100);
      expect(totals.donationsInIsk).toBe(40);
      expect(totals.donationsOutIsk).toBe(0);
    });
  });

  describe('app settings', () => {
    it('round-trips values and falls back for flags never set', () => {
      expect(getSetting('missing')).toBeNull();
      setSetting('k', 'one');
      setSetting('k', 'two');
      expect(getSetting('k')).toBe('two');

      expect(getFlag('flag', true)).toBe(true);
      setFlag('flag', false);
      expect(getFlag('flag', true)).toBe(false);
    });
  });
});
