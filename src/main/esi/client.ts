import { ESI_BASE_URL, ESI_COMPATIBILITY_DATE, USER_AGENT } from '../config';
import { refreshAccessToken } from '../auth/esi-oauth';
import { getValidCachedAccessToken } from '../auth/token-store';
import { getCached, isFresh, putCached } from '../db/repositories/esiCache';
import { rateLimiter } from './rate-limiter';
import { recordCacheFresh, recordEvent, recordSlow, recordStatus } from './esiLog';
import { collectPages, type PageResult, type PagingOptions } from './paging';

/** Retries for transient failures (5xx, network errors, timeouts). */
const MAX_RETRIES = 3;
/**
 * Backoff cycles tolerated for throttling (420/429) before giving up. Kept
 * separate from MAX_RETRIES: being rate-limited is not the request's fault, so
 * waiting out a shared backoff window must not consume the transient-error budget
 * — otherwise a fleet-wide throttle fails every in-flight request prematurely.
 */
const MAX_THROTTLE_WAITS = 6;
/** Default backoff when a 420/429 arrives without a usable Retry-After. */
const THROTTLE_FALLBACK_SECONDS = 60;
/** Abort a single request that never responds, so it can't hold a concurrency slot forever. */
const REQUEST_TIMEOUT_MS = 30_000;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface GetOptions {
  /** Character id whose access token authorizes the request; omit for public routes. */
  characterId?: number;
}

/**
 * A 4xx ESI refused outright — the request was understood and rejected, so
 * retrying changes nothing. Carries the status because callers act on it: a 403
 * on a corporation route means the character lacks the required in-game role,
 * which is a sentence to show the user rather than a failure to log.
 */
export class EsiHttpError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    readonly body: string,
  ) {
    super(`ESI GET ${path} failed: ${status} ${body}`);
    this.name = 'EsiHttpError';
  }
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

/** Total page count of a paginated route, per ESI's `X-Pages`; null on any other route. */
function pagesFromHeaders(headers: Headers): number | null {
  const raw = headers.get('x-pages');
  if (raw === null) return null;
  const pages = Number(raw);
  return Number.isInteger(pages) && pages >= 1 ? pages : null;
}

/** fetch with an abort-based timeout so a stalled socket fails fast instead of hanging. */
async function fetchWithTimeout(url: string, headers: Record<string, string>): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { headers, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** A parsed ESI body plus the one response header callers need: `X-Pages`. */
interface EsiResponse<T> {
  data: T;
  pages: number | null;
}

/**
 * Perform a cached, rate-limit-aware GET against ESI and parse the JSON body.
 * Honors ETag (304 -> cached body) and the Expires header (skips the request
 * entirely while a cached entry is still fresh).
 *
 * Two independent give-up budgets: transient failures (5xx / network) spend
 * `MAX_RETRIES`; throttling (420/429) spends `MAX_THROTTLE_WAITS`, waiting out
 * the rate limiter's shared backoff without touching the transient budget.
 *
 * Outcomes are instrumented into the ESI log (`./esiLog`) so the Settings
 * diagnostics export shows request health without one line per success.
 *
 * Response headers stay hidden from callers with the single exception of
 * `X-Pages`, which {@link esiGetPaged} needs and which is cached alongside the
 * body so a fresh cache hit still reports it.
 */
async function esiGetResponse<T>(path: string, options: GetOptions): Promise<EsiResponse<T>> {
  const url = `${ESI_BASE_URL}${path}`;
  const characterId = options.characterId;
  const cached = getCached(url);
  if (isFresh(cached)) {
    recordCacheFresh();
    return { data: JSON.parse(cached!.body) as T, pages: cached!.pages };
  }

  let refreshed = false;
  let retries = 0;
  let throttleWaits = 0;

  for (;;) {
    await rateLimiter.acquire();
    try {
      const headers: Record<string, string> = {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
        'X-Compatibility-Date': ESI_COMPATIBILITY_DATE,
      };
      if (cached?.etag) headers['If-None-Match'] = cached.etag;
      if (characterId !== undefined) {
        headers['Authorization'] = `Bearer ${await accessTokenFor(characterId)}`;
      }

      const startedAt = Date.now();
      let res: Response;
      try {
        res = await fetchWithTimeout(url, headers);
      } catch (err) {
        // Network error or timeout — transient, retry within the transient budget.
        const timedOut = err instanceof Error && err.name === 'AbortError';
        const ms = Date.now() - startedAt;
        recordEvent({
          kind: timedOut ? 'timeout' : 'network-error',
          path,
          characterId,
          ms,
          attempt: retries + 1,
          detail: timedOut ? `aborted after ${REQUEST_TIMEOUT_MS}ms` : String(err),
        });
        if (retries >= MAX_RETRIES) {
          recordEvent({ kind: 'give-up', path, characterId, detail: `${MAX_RETRIES} transient retries` });
          throw new Error(`ESI GET ${path} failed after ${MAX_RETRIES} retries: ${String(err)}`);
        }
        retries += 1;
        await sleep(500 * retries);
        continue;
      }
      const ms = Date.now() - startedAt;

      // observe() may open a proactive backoff when the error-limit budget runs
      // low; catch that transition so the export shows *why* requests paused.
      const backoffBefore = rateLimiter.backoffMs;
      rateLimiter.observe(res.headers);
      recordStatus(res.status);
      if (rateLimiter.backoffMs > backoffBefore + 1000) {
        recordEvent({
          kind: 'backoff',
          path,
          characterId,
          backoffSeconds: Math.ceil(rateLimiter.backoffMs / 1000),
          detail: 'error-limit budget low',
        });
      }
      recordSlow({ path, characterId, ms, status: res.status });

      if (res.status === 304 && cached) {
        // A 304 need not repeat X-Pages; the body it revalidates is unchanged,
        // so the page count stored with it still stands.
        const pages = pagesFromHeaders(res.headers) ?? cached.pages;
        putCached({
          url,
          etag: cached.etag,
          expiresAt: expiresFromHeaders(res.headers),
          body: cached.body,
          pages,
        });
        return { data: JSON.parse(cached.body) as T, pages };
      }

      if (res.status === 200) {
        const body = await res.text();
        const pages = pagesFromHeaders(res.headers);
        putCached({
          url,
          etag: res.headers.get('etag'),
          expiresAt: expiresFromHeaders(res.headers),
          body,
          pages,
        });
        return { data: JSON.parse(body) as T, pages };
      }

      if (res.status === 401 && characterId !== undefined && !refreshed) {
        refreshed = true;
        recordEvent({ kind: 'auth-refresh', path, characterId });
        await refreshAccessToken(characterId);
        continue;
      }

      // 429 (new floating-window bucket) and 420 (legacy error limit) are both
      // throttling: open a shared backoff and retry on a separate budget so we
      // don't burn the transient-error retries just waiting our turn.
      if (res.status === 429 || res.status === 420) {
        rateLimiter.backoffFromHeaders(res.headers, THROTTLE_FALLBACK_SECONDS);
        const backoffSeconds = Math.ceil(rateLimiter.backoffMs / 1000);
        if (throttleWaits >= MAX_THROTTLE_WAITS) {
          recordEvent({
            kind: 'give-up',
            path,
            characterId,
            status: res.status,
            detail: `throttled past ${MAX_THROTTLE_WAITS} backoffs`,
          });
          throw new Error(`ESI GET ${path} throttled: gave up after ${MAX_THROTTLE_WAITS} backoffs`);
        }
        throttleWaits += 1;
        recordEvent({
          kind: 'throttle',
          path,
          characterId,
          status: res.status,
          attempt: throttleWaits,
          backoffSeconds,
          detail: res.headers.get('retry-after') ? `retry-after ${res.headers.get('retry-after')}` : undefined,
        });
        console.warn(`[esi] ${res.status} throttled on ${path}; backing off ~${backoffSeconds}s`);
        continue;
      }

      if (res.status >= 500) {
        if (retries >= MAX_RETRIES) {
          recordEvent({ kind: 'give-up', path, characterId, status: res.status, detail: `${MAX_RETRIES} transient retries` });
          throw new Error(`ESI GET ${path} failed after ${MAX_RETRIES} retries`);
        }
        retries += 1;
        recordEvent({ kind: 'retry', path, characterId, status: res.status, attempt: retries });
        await sleep(500 * retries);
        continue;
      }

      throw new EsiHttpError(res.status, path, await res.text());
    } finally {
      rateLimiter.release();
    }
  }
}

/** Cached, rate-limit-aware GET against a single ESI route. See {@link esiGetResponse}. */
export async function esiGet<T>(path: string, options: GetOptions = {}): Promise<T> {
  return (await esiGetResponse<T>(path, options)).data;
}

interface PagedOptions<T> extends GetOptions, PagingOptions<T> {}

/** Append `page=N` to a route that may already carry a query string. */
const pageUrl = (path: string, page: number): string =>
  `${path}${path.includes('?') ? '&' : '?'}page=${page}`;

/**
 * The paginated sibling of {@link esiGet}: fetch every page of a paginated
 * route and return the concatenated items.
 *
 * Each page is an ordinary `esiGet` underneath — its own cache entry, its own
 * ETag, the same rate limiter and the same retry budgets — so a fresh page costs
 * no request at all and a stale one usually costs a bodiless 304.
 * The page count comes from ESI's `X-Pages` rather than from a guess about
 * short pages or a 404 probe; see {@link collectPages} for what that buys.
 *
 * `maxPages` and `stopAfter` let a caller read less than everything (the wallet
 * journal only wants the current month); nothing else about the loop is a
 * caller's business.
 */
export function esiGetPaged<T>(path: string, options: PagedOptions<T> = {}): Promise<T[]> {
  const { maxPages, stopAfter, ...get } = options;
  return collectPages<T>(
    (page): Promise<PageResult<T>> => esiGetResponse<T[]>(pageUrl(path, page), get),
    { maxPages, stopAfter },
  );
}
