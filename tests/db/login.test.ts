import { get } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import {
  LoginCancelledError,
  cancelLogin,
  isLoginPending,
  startLogin,
} from '@main/auth/esi-oauth';
import { grantedScopes, readRefreshToken } from '@main/auth/token-store';
import {
  ESI_CALLBACK_PORT,
  ESI_SCOPES,
  SCOPE_READ_CORP_BLUEPRINTS,
  SCOPE_READ_MINING,
} from '@main/config';
import { getCharacter, upsertCharacter } from '@main/db/repositories/characters';
import { getInvalidTokenIds, markTokenInvalid } from '@main/db/repositories/tokens';
import { getTotalSp } from '@main/db/repositories/skills';
import {
  addCharacter,
  heldOptionalScopes,
  reauthorizeCharacter,
} from '@main/services/loginService';
import { openedUrls, setOpenExternal } from './support/electron';
import {
  answerCharacter,
  seedCharacter,
  signAccessToken,
  useFakeEve,
  type FakeEve,
} from './support/fakeEve';
import { useFreshProfile } from './support/profile';

const ALICE = 90000001;
const BOB = 90000002;

/** GET a path on the loopback callback listener, as the browser would. */
function hitCallback(query: string): Promise<number> {
  return new Promise((resolve, reject) => {
    get(
      { host: '127.0.0.1', port: ESI_CALLBACK_PORT, path: `/callback?${query}`, agent: false },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode ?? 0));
      },
    ).on('error', reject);
  });
}

/** Wait until the SSO page has been "opened", and return the authorize URL. */
async function nextAuthorizeUrl(alreadySeen = 0): Promise<URL> {
  await vi.waitFor(() => expect(openedUrls.length).toBeGreaterThan(alreadySeen));
  return new URL(openedUrls[alreadySeen]!);
}

/** Finish the sign-in the way SSO does: redirect to the callback with a code. */
async function completeInBrowser(alreadySeen = 0): Promise<URL> {
  const authorize = await nextAuthorizeUrl(alreadySeen);
  const state = authorize.searchParams.get('state')!;
  expect(await hitCallback(`code=auth-code&state=${state}`)).toBe(200);
  return authorize;
}

/** SSO's code exchange: whoever "picked a character" on the login page signs in. */
function signInAs(
  eve: FakeEve,
  characterId: number,
  name: string,
  scopes: readonly string[] = ESI_SCOPES,
): void {
  eve.token((form) => ({
    body: {
      access_token: signAccessToken({ characterId, name, scopes }),
      refresh_token: `refresh-${characterId}-${form.get('grant_type')}`,
      expires_in: 1200,
      token_type: 'Bearer',
    },
  }));
}

describe('startLogin', () => {
  useFreshProfile();
  const eve = useFakeEve();

  it('stores the character and its tokens after the browser round trip', async () => {
    signInAs(eve, ALICE, 'Alice');

    const login = startLogin();
    const authorize = await completeInBrowser();
    const character = await login;

    expect(authorize.searchParams.get('scope')?.split(' ')).toEqual([...ESI_SCOPES]);
    expect(authorize.searchParams.get('code_challenge_method')).toBe('S256');
    expect(character).toMatchObject({ id: ALICE, name: 'Alice' });
    expect(getCharacter(ALICE)?.name).toBe('Alice');
    expect(readRefreshToken(ALICE)).toBe(`refresh-${ALICE}-authorization_code`);
    expect(grantedScopes(ALICE)).toEqual([...ESI_SCOPES]);
    expect(eve.tokenRequests[0]?.get('code')).toBe('auth-code');
    expect(eve.tokenRequests[0]?.get('code_verifier')).toBeTruthy();
    expect(isLoginPending()).toBe(false);
  });

  it('ignores a callback that does not carry the state of this login', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    signInAs(eve, ALICE, 'Alice');

    const login = startLogin();
    await nextAuthorizeUrl();
    expect(await hitCallback('code=stolen&state=not-the-state')).toBe(400);
    expect(isLoginPending()).toBe(true);

    await completeInBrowser();
    await expect(login).resolves.toMatchObject({ id: ALICE });
    expect(eve.tokenRequests).toHaveLength(1);
    warn.mockRestore();
  });

  it('can be cancelled, which frees the callback port for the next sign-in', async () => {
    signInAs(eve, ALICE, 'Alice');

    const abandoned = startLogin();
    await nextAuthorizeUrl();
    expect(cancelLogin()).toBe(true);
    await expect(abandoned).rejects.toBeInstanceOf(LoginCancelledError);
    expect(isLoginPending()).toBe(false);
    expect(cancelLogin()).toBe(false);
    expect(getCharacter(ALICE)).toBeNull();

    // Straight away, on the same port — not after the five-minute timeout.
    const next = startLogin();
    await completeInBrowser(1);
    await expect(next).resolves.toMatchObject({ id: ALICE });
  });

  it('refuses a second sign-in while one is waiting', async () => {
    const first = startLogin();
    await nextAuthorizeUrl();

    await expect(startLogin()).rejects.toThrow(/already waiting/);
    // The refusal must not have disturbed the one in progress.
    expect(isLoginPending()).toBe(true);

    cancelLogin();
    await expect(first).rejects.toBeInstanceOf(LoginCancelledError);
  });

  it('releases the port when the browser cannot be opened', async () => {
    setOpenExternal(async () => {
      throw new Error('no browser');
    });
    await expect(startLogin()).rejects.toThrow(/could not open your browser/);
    expect(isLoginPending()).toBe(false);

    setOpenExternal(null);
    signInAs(eve, ALICE, 'Alice');
    const next = startLogin();
    await completeInBrowser(1);
    await expect(next).resolves.toMatchObject({ id: ALICE });
  });

  it('stores nothing from a token it cannot verify', async () => {
    eve.token(() => ({
      body: {
        // A well-formed token whose signature is not the SSO key's.
        access_token: signAccessToken({ characterId: ALICE }).replace(/\.[^.]+$/, '.AAAA'),
        refresh_token: 'r',
        expires_in: 1200,
        token_type: 'Bearer',
      },
    }));

    // Watched from the start: the rejection lands while the callback request
    // below is still being answered.
    const refused = expect(startLogin()).rejects.toThrow(/could not verify/);
    await completeInBrowser();

    await refused;
    expect(getCharacter(ALICE)).toBeNull();
  });
});

describe('adding and re-authorizing characters', () => {
  useFreshProfile();
  const eve = useFakeEve();

  it('adds a character and syncs it before answering', async () => {
    signInAs(eve, ALICE, 'Alice');
    answerCharacter(eve, ALICE, 'Alice');

    const adding = addCharacter();
    await completeInBrowser();
    const result = await adding;

    expect(result).toMatchObject({ outcome: 'signed-in', character: { id: ALICE } });
    expect(getTotalSp(ALICE)).toBe(1_280_000);
  });

  it('answers at once when the sync is deferred, and announces it when it lands', async () => {
    signInAs(eve, ALICE, 'Alice');
    answerCharacter(eve, ALICE, 'Alice');
    let release = (): void => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    eve.esi(`/characters/${ALICE}/skills`, async () => {
      await held;
      return { body: { total_sp: 5, skills: [] } };
    });
    const onSynced = vi.fn();

    const adding = addCharacter({ deferSync: true, onSynced });
    await completeInBrowser();
    const result = await adding;

    // Back already, though ESI has not answered: the next sign-in can start.
    expect(result.outcome).toBe('signed-in');
    expect(onSynced).not.toHaveBeenCalled();
    expect(getCharacter(ALICE)?.refreshedAt).toBeNull();

    release();
    await vi.waitFor(() => expect(onSynced).toHaveBeenCalledTimes(1));
    expect(getCharacter(ALICE)?.refreshedAt).not.toBeNull();
  });

  it('still answers signed-in when the first sync fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    signInAs(eve, ALICE, 'Alice'); // no ESI routes answered: every read 404s

    const adding = addCharacter();
    await completeInBrowser();

    await expect(adding).resolves.toMatchObject({ outcome: 'signed-in' });
    expect(getCharacter(ALICE)).not.toBeNull();
    warn.mockRestore();
  });

  it('reports a cancelled sign-in as an outcome, not an error', async () => {
    const adding = addCharacter();
    await nextAuthorizeUrl();
    cancelLogin();
    await expect(adding).resolves.toEqual({ outcome: 'cancelled' });
  });

  it('repairs an expired login and picks up a scope added since', async () => {
    const before = ESI_SCOPES.filter((s) => s !== SCOPE_READ_MINING);
    seedCharacter({ characterId: ALICE, name: 'Alice', scopes: before });
    upsertCharacter({ id: ALICE, name: 'Alice', corpId: 98000001 });
    markTokenInvalid(ALICE);
    signInAs(eve, ALICE, 'Alice');
    answerCharacter(eve, ALICE, 'Alice');

    const reauth = reauthorizeCharacter(ALICE);
    await completeInBrowser();
    const result = await reauth;

    expect(result).toMatchObject({ outcome: 'signed-in', character: { id: ALICE } });
    expect(getInvalidTokenIds().size).toBe(0);
    expect(grantedScopes(ALICE)).toContain(SCOPE_READ_MINING);
    // Signing in again must not blank what a sync recorded.
    expect(getCharacter(ALICE)?.corpId).toBe(98000001);
  });

  it('asks again for an opt-in scope the character holds, so the repair does not drop it', async () => {
    const withCorp = [...ESI_SCOPES, SCOPE_READ_CORP_BLUEPRINTS];
    seedCharacter({ characterId: ALICE, name: 'Alice', scopes: withCorp });
    seedCharacter({ characterId: BOB, name: 'Bob' });
    expect(heldOptionalScopes(ALICE)).toEqual([SCOPE_READ_CORP_BLUEPRINTS]);
    expect(heldOptionalScopes(BOB)).toEqual([]);

    signInAs(eve, ALICE, 'Alice', withCorp);
    const reauth = reauthorizeCharacter(ALICE);
    const authorize = await completeInBrowser();
    await reauth;
    expect(authorize.searchParams.get('scope')?.split(' ')).toContain(SCOPE_READ_CORP_BLUEPRINTS);
    expect(grantedScopes(ALICE)).toContain(SCOPE_READ_CORP_BLUEPRINTS);

    // A character that never opted in is not asked for it.
    signInAs(eve, BOB, 'Bob');
    const plain = reauthorizeCharacter(BOB);
    const plainAuthorize = await completeInBrowser(1);
    await plain;
    expect(plainAuthorize.searchParams.get('scope')?.split(' ')).not.toContain(
      SCOPE_READ_CORP_BLUEPRINTS,
    );
  });

  it('hands back whoever actually signed in when the user picks another character', async () => {
    seedCharacter({ characterId: ALICE, name: 'Alice' });
    seedCharacter({ characterId: BOB, name: 'Bob' });
    markTokenInvalid(ALICE);
    markTokenInvalid(BOB);
    signInAs(eve, BOB, 'Bob');

    const reauth = reauthorizeCharacter(ALICE);
    await completeInBrowser();
    const result = await reauth;

    expect(result).toMatchObject({ outcome: 'signed-in', character: { id: BOB, name: 'Bob' } });
    // The sign-in for Bob was a real one and is kept; Alice is still expired.
    expect([...getInvalidTokenIds()]).toEqual([ALICE]);
  });

  it('refuses to re-authorize a character it does not track', async () => {
    await expect(reauthorizeCharacter(12345)).rejects.toThrow(/Unknown character/);
    expect(openedUrls).toEqual([]);
  });
});
