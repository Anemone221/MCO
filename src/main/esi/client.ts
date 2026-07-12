import { ESI_BASE_URL, USER_AGENT } from '../config';
import { refreshAccessToken } from '../auth/esi-oauth';
import { getValidCachedAccessToken } from '../auth/token-store';
import { getCached, isFresh, putCached } from '../db/repositories/esiCache';
import { rateLimiter } from './rate-limiter';

const MAX_RETRIES = 3;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface GetOptions {
  /** Character id whose access token authorizes the request; omit for public routes. */
  characterId?: number;
}

async function accessTokenFor(characterId: number): Promise<string> {
  return getValidCachedAccessToken(characterId) ?? (await refreshAccessToken(characterId));
}

function expiresFromHeaders(headers: Headers): string | null {
  const expires = headers.get('expires');
  if (expires) {
    const ts = Date.parse(expires);
    if (!Number.isNaN(ts)) return new Date(ts).toISOString();
  }
  return null;
}

/**
 * Perform a cached, rate-limit-aware GET against ESI and parse the JSON body.
 * Honors ETag (304 -> cached body) and the Expires header (skips the request
 * entirely while a cached entry is still fresh).
 */
export async function esiGet<T>(path: string, options: GetOptions = {}): Promise<T> {
  const url = `${ESI_BASE_URL}${path}`;
  const cached = getCached(url);
  if (isFresh(cached)) return JSON.parse(cached!.body) as T;

  let refreshed = false;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    await rateLimiter.acquire();
    try {
      const headers: Record<string, string> = { 'User-Agent': USER_AGENT, Accept: 'application/json' };
      if (cached?.etag) headers['If-None-Match'] = cached.etag;
      if (options.characterId !== undefined) {
        headers['Authorization'] = `Bearer ${await accessTokenFor(options.characterId)}`;
      }

      const res = await fetch(url, { headers });
      rateLimiter.observe(res.headers);

      if (res.status === 304 && cached) {
        putCached({ url, etag: cached.etag, expiresAt: expiresFromHeaders(res.headers), body: cached.body });
        return JSON.parse(cached.body) as T;
      }

      if (res.status === 200) {
        const body = await res.text();
        putCached({ url, etag: res.headers.get('etag'), expiresAt: expiresFromHeaders(res.headers), body });
        return JSON.parse(body) as T;
      }

      if (res.status === 401 && options.characterId !== undefined && !refreshed) {
        refreshed = true;
        await refreshAccessToken(options.characterId);
        continue;
      }

      if (res.status === 420) {
        rateLimiter.forceBackoff(60);
        continue;
      }

      if (res.status >= 500) {
        await sleep(500 * (attempt + 1));
        continue;
      }

      throw new Error(`ESI GET ${path} failed: ${res.status} ${await res.text()}`);
    } finally {
      rateLimiter.release();
    }
  }

  throw new Error(`ESI GET ${path} failed after ${MAX_RETRIES} retries`);
}
