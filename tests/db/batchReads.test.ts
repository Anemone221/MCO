import { describe, expect, it } from 'vitest';
import { ESI_SCOPES, SCOPE_READ_MINING, SCOPE_READ_ONLINE } from '@main/config';
import { grantedScopes, grantedScopesByCharacter } from '@main/auth/token-store';
import { ensureCharacter } from '@main/db/repositories/characters';
import { getCachedMany, putCached } from '@main/db/repositories/esiCache';
import {
  getAllQueues,
  getQueue,
  getTotalSp,
  getTotalSpByCharacter,
  replaceQueue,
  replaceSkills,
} from '@main/db/repositories/skills';
import {
  addTagToCharacter,
  createTag,
  listTagsByCharacter,
  listTagsForCharacter,
} from '@main/db/repositories/tags';
import { seedCharacter } from './support/fakeEve';
import { useFreshProfile } from './support/profile';

const ALICE = 90000001;
const BOB = 90000002;
const CAROL = 90000003;

/**
 * The one-query-for-everyone reads the roster, the dashboard, the group page
 * and live tracking use must say exactly what the per-character reads say,
 * character by character — otherwise a page and a detail view disagree.
 */
describe('batched reads agree with their per-character twins', () => {
  useFreshProfile();

  it('total SP', () => {
    ensureCharacter(ALICE, 'Alice');
    ensureCharacter(BOB, 'Bob');
    ensureCharacter(CAROL, 'Carol');
    replaceSkills(ALICE, [
      { skillTypeId: 3300, sp: 256_000, trainedLevel: 5, activeLevel: 5 },
      { skillTypeId: 3327, sp: 1_024_000, trainedLevel: 5, activeLevel: 5 },
    ]);
    replaceSkills(BOB, [{ skillTypeId: 3300, sp: 750, trainedLevel: 1, activeLevel: 1 }]);

    const batched = getTotalSpByCharacter();
    expect(batched.get(ALICE)).toBe(getTotalSp(ALICE));
    expect(batched.get(BOB)).toBe(getTotalSp(BOB));
    // No skills stored: absent from the map, 0 from the single read.
    expect(batched.has(CAROL)).toBe(false);
    expect(getTotalSp(CAROL)).toBe(0);
  });

  it('skill queues, in position order', () => {
    ensureCharacter(ALICE, 'Alice');
    ensureCharacter(BOB, 'Bob');
    replaceQueue(ALICE, [
      { position: 1, skillTypeId: 3328, finishLevel: 5, startDate: null, finishDate: null },
      { position: 0, skillTypeId: 3328, finishLevel: 4, startDate: 'a', finishDate: 'b' },
    ]);
    replaceQueue(BOB, []);

    const batched = getAllQueues();
    expect(batched.get(ALICE)).toEqual(getQueue(ALICE));
    expect(batched.get(ALICE)!.map((q) => q.position)).toEqual([0, 1]);
    expect(batched.has(BOB)).toBe(false);
    expect(getQueue(BOB)).toEqual([]);
  });

  it('tags, in name order', () => {
    ensureCharacter(ALICE, 'Alice');
    ensureCharacter(BOB, 'Bob');
    const fax = createTag('Fax');
    const cyno = createTag('Cyno', '#fff');
    addTagToCharacter(fax.id, ALICE);
    addTagToCharacter(cyno.id, ALICE);
    addTagToCharacter(cyno.id, BOB);

    const batched = listTagsByCharacter();
    expect(batched.get(ALICE)).toEqual(listTagsForCharacter(ALICE));
    expect(batched.get(ALICE)!.map((t) => t.name)).toEqual(['Cyno', 'Fax']);
    expect(batched.get(BOB)).toEqual(listTagsForCharacter(BOB));
  });

  it('cache entries for many URLs', () => {
    putCached({ url: 'https://a', etag: null, expiresAt: null, body: '1', pages: null });
    putCached({ url: 'https://b', etag: 'x', expiresAt: '2030-01-01T00:00:00Z', body: '2', pages: 3 });

    const many = getCachedMany(['https://a', 'https://b', 'https://never']);
    expect([...many.keys()].sort()).toEqual(['https://a', 'https://b']);
    expect(many.get('https://b')).toMatchObject({ etag: 'x', body: '2', pages: 3 });
    expect(getCachedMany([]).size).toBe(0);
  });

  it('granted scopes, and both follow a token that changes', () => {
    seedCharacter({ characterId: ALICE, scopes: ESI_SCOPES });
    seedCharacter({ characterId: BOB, scopes: [SCOPE_READ_ONLINE] });
    ensureCharacter(CAROL, 'Carol'); // tracked, but never signed in

    const batched = grantedScopesByCharacter();
    expect(batched.get(ALICE)).toEqual(grantedScopes(ALICE));
    expect(batched.get(BOB)).toEqual([SCOPE_READ_ONLINE]);
    expect(batched.has(CAROL)).toBe(false);
    expect(grantedScopes(CAROL)).toEqual([]);

    // A new sign-in with a narrower grant rewrites the row; the remembered
    // decode must not outlive it.
    seedCharacter({ characterId: ALICE, scopes: [SCOPE_READ_MINING] });
    expect(grantedScopes(ALICE)).toEqual([SCOPE_READ_MINING]);
    expect(grantedScopesByCharacter().get(ALICE)).toEqual([SCOPE_READ_MINING]);
  });
});
