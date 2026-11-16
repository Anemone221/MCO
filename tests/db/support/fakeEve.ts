import { createSign, generateKeyPairSync } from 'node:crypto';
import { afterEach, beforeEach, vi } from 'vitest';
import { cacheAccessToken, persistRefreshToken } from '@main/auth/token-store';
import {
  ESI_BASE_URL,
  ESI_CLIENT_ID,
  ESI_SCOPES,
  SSO_JWKS_URL,
  SSO_TOKEN_URL,
} from '@main/config';
import { ensureCharacter } from '@main/db/repositories/characters';

/**
 * A stand-in for everything MCO reaches over the network: EVE SSO's token and
 * key endpoints, and ESI. Installed as the global `fetch`, so the real ESI
 * client — caching, token refresh, retries, paging — runs unmodified on top.
 *
 * Tokens are signed with a throwaway RSA key whose public half the fake JWKS
 * endpoint serves, so the real signature and claim checks run too.
 */

const KEY_ID = 'mco-test-key';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });

const encode = (value: unknown): string =>
  Buffer.from(JSON.stringify(value)).toString('base64url');

export interface TokenClaims {
  characterId: number;
  name?: string;
  scopes?: readonly string[];
  /** Seconds until expiry; negative mints a token that is already dead. */
  expiresIn?: number;
}

/** An access token EVE SSO could have issued for this application. */
export function signAccessToken(claims: TokenClaims): string {
  const now = Math.floor(Date.now() / 1000);
  const header = encode({ alg: 'RS256', kid: KEY_ID, typ: 'JWT' });
  const payload = encode({
    sub: `CHARACTER:EVE:${claims.characterId}`,
    name: claims.name ?? `Character ${claims.characterId}`,
    scp: [...(claims.scopes ?? ESI_SCOPES)],
    iss: 'https://login.eveonline.com',
    aud: [ESI_CLIENT_ID, 'EVE Online'],
    iat: now,
    exp: now + (claims.expiresIn ?? 1200),
  });
  const signature = createSign('RSA-SHA256')
    .update(`${header}.${payload}`)
    .sign(privateKey)
    .toString('base64url');
  return `${header}.${payload}.${signature}`;
}

/**
 * Put a signed-in character in the database: its row, an encrypted refresh
 * token and a live access token — what a finished login leaves behind.
 */
export function seedCharacter(claims: TokenClaims): void {
  const name = claims.name ?? `Character ${claims.characterId}`;
  ensureCharacter(claims.characterId, name);
  persistRefreshToken(
    claims.characterId,
    `refresh-${claims.characterId}-0`,
    [...(claims.scopes ?? ESI_SCOPES)].join(' '),
  );
  cacheAccessToken(
    claims.characterId,
    signAccessToken({ ...claims, name }),
    new Date(Date.now() + (claims.expiresIn ?? 1200) * 1000),
  );
}

export interface EsiReply {
  status?: number;
  body?: unknown;
  /** Seconds the response stays fresh (the `Expires` header). Default 300. */
  expiresIn?: number;
  etag?: string;
  /** `X-Pages`, for a paginated route. */
  pages?: number;
  headers?: Record<string, string>;
}

type EsiHandler = (request: { path: string; headers: Headers }) => EsiReply | Promise<EsiReply>;
type TokenHandler = (form: URLSearchParams) => { status?: number; body: unknown };

export interface FakeEve {
  /** Answer one ESI path (including any query string) with a fixed reply or a handler. */
  esi(path: string, reply: EsiReply | EsiHandler): void;
  /** Answer the SSO token endpoint — code exchange and refresh alike. */
  token(handler: TokenHandler): void;
  /** Every ESI path requested, in order. */
  readonly esiRequests: string[];
  /** Every form posted to the token endpoint, in order. */
  readonly tokenRequests: URLSearchParams[];
  /** How many times one ESI path was requested. */
  count(path: string): number;
  /**
   * Pull the cable: every ESI request fails the way a dead network does (the
   * attempt is still recorded), until called again with false.
   */
  offline(value: boolean): void;
}

function esiResponse(reply: EsiReply): Response {
  const status = reply.status ?? 200;
  const headers = new Headers(reply.headers);
  headers.set('expires', new Date(Date.now() + (reply.expiresIn ?? 300) * 1000).toUTCString());
  if (reply.etag) headers.set('etag', reply.etag);
  if (reply.pages !== undefined) headers.set('x-pages', String(reply.pages));
  // 304 and friends carry no body, and `Response` refuses one.
  const body = status === 304 || status === 204 ? null : JSON.stringify(reply.body ?? null);
  return new Response(body, { status, headers });
}

/**
 * Replace the global `fetch` for every test in the calling file. Anything not
 * explicitly answered is a 404 from ESI and an error anywhere else, so a test
 * cannot reach the real network by omission.
 */
export function useFakeEve(): FakeEve {
  const esiRoutes = new Map<string, EsiReply | EsiHandler>();
  let tokenHandler: TokenHandler | null = null;
  const esiRequests: string[] = [];
  const tokenRequests: URLSearchParams[] = [];
  let offline = false;

  const fake: FakeEve = {
    esi: (path, reply) => void esiRoutes.set(path, reply),
    token: (handler) => {
      tokenHandler = handler;
    },
    esiRequests,
    tokenRequests,
    count: (path) => esiRequests.filter((p) => p === path).length,
    offline: (value) => {
      offline = value;
    },
  };

  beforeEach(() => {
    esiRoutes.clear();
    tokenHandler = null;
    esiRequests.length = 0;
    tokenRequests.length = 0;
    offline = false;

    vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

      if (url === SSO_JWKS_URL) {
        const jwk = publicKey.export({ format: 'jwk' });
        return Response.json({ keys: [{ ...jwk, kid: KEY_ID, alg: 'RS256', use: 'sig' }] });
      }

      if (url === SSO_TOKEN_URL) {
        const form = new URLSearchParams(String(init?.body ?? ''));
        tokenRequests.push(form);
        if (!tokenHandler) return new Response('no token handler', { status: 500 });
        const { status = 200, body } = tokenHandler(form);
        return new Response(JSON.stringify(body), { status });
      }

      if (url.startsWith(ESI_BASE_URL)) {
        const path = url.slice(ESI_BASE_URL.length);
        esiRequests.push(path);
        if (offline) throw new TypeError('fetch failed');
        const route = esiRoutes.get(path);
        if (route === undefined) return esiResponse({ status: 404, body: { error: 'not found' } });
        const reply =
          typeof route === 'function'
            ? await route({ path, headers: new Headers(init?.headers) })
            : route;
        return esiResponse(reply);
      }

      throw new Error(`Unexpected network request in a test: ${url}`);
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  return fake;
}

/** A skill-queue entry finishing `hours` from now. */
function queueEntry(position: number, skillId: number, level: number, hours: number): unknown {
  return {
    queue_position: position,
    skill_id: skillId,
    finished_level: level,
    start_date: new Date(Date.now() - 3_600_000).toISOString(),
    finish_date: new Date(Date.now() + hours * 3_600_000).toISOString(),
  };
}

/**
 * Answer every route a full-scope character sync reads, with small but real
 * data: two skills, a two-entry queue, a station location, one jump clone, a
 * wallet with one tracked journal entry, one day of mining and one blueprint
 * original. Individual routes can be re-answered afterwards.
 */
export function answerCharacter(eve: FakeEve, characterId: number, name: string): void {
  const base = `/characters/${characterId}`;
  eve.esi(base, {
    body: { name, corporation_id: 98000001, alliance_id: 99000001, birthday: '2015-01-01T00:00:00Z' },
  });
  eve.esi(`${base}/skills`, {
    body: {
      total_sp: 1_280_000,
      skills: [
        { skill_id: 3300, skillpoints_in_skill: 256_000, trained_skill_level: 5, active_skill_level: 5 },
        { skill_id: 3327, skillpoints_in_skill: 1_024_000, trained_skill_level: 5, active_skill_level: 5 },
      ],
    },
  });
  eve.esi(`${base}/skillqueue`, {
    body: [queueEntry(0, 3328, 4, 6), queueEntry(1, 3328, 5, 96)],
  });
  eve.esi(`${base}/location`, { body: { solar_system_id: 30000142, station_id: 60003760 } });
  eve.esi(`${base}/ship`, {
    body: { ship_type_id: 587, ship_name: 'Test Rifter', ship_item_id: 1_000_000_000_001 },
  });
  eve.esi(`${base}/implants`, { body: [9899, 9941] });
  eve.esi(`${base}/clones`, {
    body: {
      home_location: { location_id: 60003760, location_type: 'station' },
      jump_clones: [
        { jump_clone_id: 501, location_id: 60008494, location_type: 'station', implants: [9942] },
      ],
      last_clone_jump_date: '2026-01-01T00:00:00Z',
    },
  });
  eve.esi(`${base}/fatigue`, { body: {} });
  eve.esi(`${base}/wallet`, { body: 1_234_567.89 });
  eve.esi(`${base}/wallet/journal?page=1`, {
    pages: 1,
    body: [
      { id: 7001, ref_type: 'bounty_prizes', amount: 250_000, tax: 25_000, date: new Date().toISOString() },
      { id: 7002, ref_type: 'market_escrow', amount: -10, date: new Date().toISOString() },
    ],
  });
  eve.esi(`${base}/mining?page=1`, {
    pages: 1,
    body: [{ date: '2026-11-01', quantity: 5000, solar_system_id: 30000142, type_id: 1230 }],
  });
  eve.esi(`${base}/structures/mercenary-dens`, { body: { mercenary_dens: [] } });
  eve.esi(`${base}/mercenary-tactical-operations`, { body: { operations: [] } });
  eve.esi(`${base}/blueprints?page=1`, {
    pages: 1,
    body: [
      {
        item_id: 9_000_000_000 + characterId,
        type_id: 691,
        location_id: 60003760,
        location_flag: 'Hangar',
        quantity: -1,
        runs: -1,
        material_efficiency: 10,
        time_efficiency: 20,
      },
    ],
  });
  eve.esi(`${base}/online`, { body: { online: false, last_logout: '2026-11-01T10:00:00Z' } });
  eve.esi(`${base}/attributes`, {
    body: { intelligence: 20, memory: 20, charisma: 19, perception: 20, willpower: 20 },
  });
}
