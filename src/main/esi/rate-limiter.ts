/**
 * Respects ESI's error-limit window and per-route rate limits, paces request
 * dispatch, and bounds request concurrency.
 * See https://developers.eveonline.com/docs/services/esi/rate-limiting/
 *
 * Four cooperating controls:
 *  - **Concurrency cap** — at most `maxConcurrency` requests in flight, a ceiling
 *    on burst width.
 *  - **Dispatch pacer** — a minimum spacing between successive request starts, so a
 *    "sweep" of 90+ characters trickles out at a steady rate instead of firing as
 *    fast as ESI can answer. This is what keeps us clear of the error cascade a
 *    burst provokes and is the "offset requests" behaviour a large fleet needs.
 *  - **Backoff window** — a hard pause for everyone after a 420 (legacy error
 *    limit, which is per IP and so genuinely app-wide), or after a 429 on a route
 *    whose rate-limit group is unknown. Honoured before any dispatch.
 *  - **Route buckets** — ESI's floating-window limiter keeps one token bucket per
 *    (route group, applicationID:characterID). Responses on such routes carry
 *    `X-Ratelimit-Group`, `X-Ratelimit-Limit` (`150/15m`) and
 *    `X-Ratelimit-Remaining`, so the limiter learns which group a route is in and
 *    how much of that bucket is left. When a bucket runs low, requests to *that
 *    bucket only* are spaced to the window's sustainable rate; a 429 blocks that
 *    bucket for its `Retry-After` instead of pausing the whole app.
 */

const DEFAULT_MAX_CONCURRENCY = 20;
/** ~8 requests/second steady-state — gentle, and drains a full-fleet sweep in ~2 min. */
const DEFAULT_MIN_SPACING_MS = 120;
const ERROR_LIMIT_FLOOR = 10;
/** Tokens a 2xx costs in a floating-window bucket — the most a normal request spends. */
const TOKENS_PER_SUCCESS = 2;
/** A bucket counts as low at or below this fraction of its limit… */
const ROUTE_LOW_FRACTION = 0.1;
/** …and never below this many tokens, so a small bucket still keeps some headroom. */
const ROUTE_LOW_FLOOR = 4;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export interface RateLimiterOptions {
  maxConcurrency?: number;
  /** Minimum gap between successive request dispatches; 0 disables pacing. */
  minSpacingMs?: number;
}

/**
 * Parse a `Retry-After` header (delta-seconds or an HTTP-date), falling back to
 * `fallbackSeconds` when it is absent or unparseable.
 */
export function parseRetryAfter(value: string | null, fallbackSeconds: number): number {
  if (value === null) return fallbackSeconds;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds);
  const date = Date.parse(value);
  if (!Number.isNaN(date)) return Math.max(0, (date - Date.now()) / 1000);
  return fallbackSeconds;
}

/** A parsed `X-Ratelimit-Limit` value such as `150/15m`. */
export interface RouteLimit {
  tokens: number;
  windowMs: number;
}

const WINDOW_UNIT_MS: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000 };

/** Parse `X-Ratelimit-Limit` (`<tokens>/<n><s|m|h>`); null when absent or malformed. */
export function parseRateLimit(value: string | null): RouteLimit | null {
  if (value === null) return null;
  const match = /^\s*(\d+)\s*\/\s*(\d+)\s*([smh])\s*$/i.exec(value);
  if (!match) return null;
  const [, tokensRaw, countRaw, unit] = match;
  const unitMs = unit === undefined ? undefined : WINDOW_UNIT_MS[unit.toLowerCase()];
  if (tokensRaw === undefined || countRaw === undefined || unitMs === undefined) return null;
  const tokens = Number(tokensRaw);
  const windowMs = Number(countRaw) * unitMs;
  return tokens > 0 && windowMs > 0 ? { tokens, windowMs } : null;
}

/**
 * The route a path belongs to, independent of the ids and query in it:
 * `/characters/123/assets?page=2` → `/characters/{id}/assets`. ESI assigns rate
 * limit groups per route, so a learned group is remembered under this.
 */
export function routePattern(path: string): string {
  const queryAt = path.indexOf('?');
  const bare = queryAt === -1 ? path : path.slice(0, queryAt);
  return bare.replace(/\/\d+(?=\/|$)/g, '/{id}');
}

interface RouteBucket {
  limit: RouteLimit;
  /** Tokens left as of the last response, per `X-Ratelimit-Remaining`. */
  remaining: number;
  /** When `remaining` was read; once a full window has passed, every token is back. */
  observedAt: number;
  /** Dispatch cursor, used only while the bucket is low. */
  nextAt: number;
  /** From a 429's `Retry-After`: nothing goes to this bucket before this time. */
  blockedUntil: number;
}

/** What {@link RateLimiter.observeRoute} learned from one response. */
export interface RouteObservation {
  group: string;
  remaining: number;
  limit: RouteLimit;
  /** This response took the bucket from healthy to low (worth one log line). */
  becameLow: boolean;
}

const lowWater = (limit: RouteLimit): number =>
  Math.max(ROUTE_LOW_FLOOR, Math.ceil(limit.tokens * ROUTE_LOW_FRACTION));

/** Sustainable gap between 2xx requests to one bucket: a 150/15m bucket allows one per 12 s. */
const sustainableSpacingMs = (limit: RouteLimit): number =>
  (limit.windowMs * TOKENS_PER_SUCCESS) / limit.tokens;

export class RateLimiter {
  private active = 0;
  private readonly waiters: Array<() => void> = [];
  private backoffUntil = 0;
  /** Earliest wall-clock time the next request may be dispatched (pacer cursor). */
  private nextDispatchAt = 0;
  private readonly maxConcurrency: number;
  private readonly minSpacingMs: number;
  /** Route pattern → rate-limit group, learned from `X-Ratelimit-Group`. */
  private readonly routeGroups = new Map<string, string>();
  /** `group|owner` → bucket state; the owner is the character id, or `public`. */
  private readonly buckets = new Map<string, RouteBucket>();

  constructor(options: RateLimiterOptions = {}) {
    this.maxConcurrency = options.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY;
    this.minSpacingMs = options.minSpacingMs ?? DEFAULT_MIN_SPACING_MS;
  }

  /** Milliseconds remaining in the current app-wide backoff window (0 when clear). */
  get backoffMs(): number {
    return Math.max(0, this.backoffUntil - Date.now());
  }

  /**
   * Wait until this request's route bucket (if known) will take it, then acquire
   * a concurrency slot, then wait for the paced dispatch turn. The bucket wait
   * comes first so a request held back by a low or blocked bucket does not sit
   * on a slot that requests to other routes could use.
   */
  async acquire(path?: string, characterId?: number): Promise<void> {
    if (path !== undefined) await this.waitForRoute(path, characterId);
    if (this.active >= this.maxConcurrency) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    this.active += 1;
    await this.pace();
  }

  /**
   * Reserve and wait for this request's dispatch slot. The slot is the later of
   * "now", the pacer cursor, and any active backoff window; reserving advances
   * the cursor so the next caller is spaced after this one. Re-checks after
   * sleeping so a backoff opened mid-wait (another request just got 420/429) is
   * never dispatched into.
   */
  private async pace(): Promise<void> {
    for (;;) {
      const now = Date.now();
      // The cursor can legitimately sit at most one slot per in-flight request
      // ahead of now. Further than that means the clock went backwards (an NTP
      // correction, or a test's fake clock), and a stranded cursor would hold
      // every request until the wall clock caught up.
      const horizon = now + this.minSpacingMs * this.maxConcurrency;
      if (this.nextDispatchAt > horizon) this.nextDispatchAt = horizon;
      const earliest = Math.max(now, this.nextDispatchAt, this.backoffUntil);
      this.nextDispatchAt = earliest + this.minSpacingMs;
      const wait = earliest - now;
      if (wait <= 0) return;
      await sleep(wait);
      if (Date.now() >= this.backoffUntil) return;
    }
  }

  release(): void {
    this.active -= 1;
    const next = this.waiters.shift();
    if (next) next();
  }

  private bucketKey(path: string, characterId: number | undefined): string | null {
    const group = this.routeGroups.get(routePattern(path));
    return group === undefined ? null : `${group}|${characterId ?? 'public'}`;
  }

  /** Low = at or under the low-water mark, and read recently enough to still be true. */
  private isLow(bucket: RouteBucket, now: number): boolean {
    if (now - bucket.observedAt >= bucket.limit.windowMs) return false;
    return bucket.remaining <= lowWater(bucket.limit);
  }

  /**
   * Hold a request to a low or blocked bucket. A low bucket is spaced at the
   * window's sustainable rate, which is ESI's "start to slow down" rather than a
   * stop; a blocked one waits out its 429's `Retry-After`. Requests to every other
   * bucket are untouched.
   */
  private async waitForRoute(path: string, characterId: number | undefined): Promise<void> {
    const key = this.bucketKey(path, characterId);
    if (key === null) return;
    for (;;) {
      const bucket = this.buckets.get(key);
      if (!bucket) return;
      const now = Date.now();
      let earliest = Math.max(now, bucket.blockedUntil);
      if (this.isLow(bucket, now)) {
        const spacing = sustainableSpacingMs(bucket.limit);
        // Same clock-skew guard as the pacer: never trust a cursor further out
        // than one spacing per request that could be queued behind it.
        const horizon = now + spacing * this.maxConcurrency;
        if (bucket.nextAt > horizon) bucket.nextAt = horizon;
        earliest = Math.max(earliest, bucket.nextAt);
        bucket.nextAt = earliest + spacing;
      }
      const wait = earliest - now;
      if (wait <= 0) return;
      await sleep(wait);
      if (Date.now() >= bucket.blockedUntil) return;
    }
  }

  /** Milliseconds this route's bucket is blocked by a 429 (0 when clear or unknown). */
  routeBlockedMs(path: string, characterId?: number): number {
    const key = this.bucketKey(path, characterId);
    const bucket = key === null ? undefined : this.buckets.get(key);
    return bucket ? Math.max(0, bucket.blockedUntil - Date.now()) : 0;
  }

  /** Update the app-wide backoff from an ESI response's legacy error-limit headers. */
  observe(headers: Headers): void {
    const remainRaw = headers.get('x-esi-error-limit-remain');
    const resetRaw = headers.get('x-esi-error-limit-reset');
    if (remainRaw === null || resetRaw === null) return;

    const remain = Number(remainRaw);
    const resetSeconds = Number(resetRaw);
    if (Number.isFinite(remain) && Number.isFinite(resetSeconds) && remain <= ERROR_LIMIT_FLOOR) {
      this.backoffUntil = Date.now() + resetSeconds * 1000;
    }
  }

  /**
   * Learn from a response's floating-window headers: which group the route is in
   * and how much of that bucket is left. Null for routes not (yet) under the new
   * limiter, which send no `X-Ratelimit-*` headers.
   */
  observeRoute(
    path: string,
    characterId: number | undefined,
    headers: Headers,
  ): RouteObservation | null {
    const group = headers.get('x-ratelimit-group');
    const limit = parseRateLimit(headers.get('x-ratelimit-limit'));
    const remainingRaw = headers.get('x-ratelimit-remaining');
    const remaining = Number(remainingRaw);
    if (!group || !limit || remainingRaw === null || !Number.isFinite(remaining)) return null;

    this.routeGroups.set(routePattern(path), group);
    const key = `${group}|${characterId ?? 'public'}`;
    const now = Date.now();
    const existing = this.buckets.get(key);
    const wasLow = existing ? this.isLow(existing, now) : false;
    const bucket = existing ?? { limit, remaining, observedAt: now, nextAt: 0, blockedUntil: 0 };
    bucket.limit = limit;
    bucket.remaining = remaining;
    bucket.observedAt = now;
    this.buckets.set(key, bucket);
    const low = this.isLow(bucket, now);
    return { group, remaining, limit, becameLow: low && !wasLow };
  }

  /**
   * Handle a 429 for one route: block just its bucket for `Retry-After` and
   * return the seconds blocked. Returns null when the route's group is unknown —
   * no headers on this 429 and none seen on the route before (ESI notes some
   * routes have a server-side limiter that 429s without them) — and the caller
   * falls back to the app-wide backoff, since there is no bucket to confine it to.
   */
  blockRoute(
    path: string,
    characterId: number | undefined,
    headers: Headers,
    fallbackSeconds: number,
  ): number | null {
    this.observeRoute(path, characterId, headers);
    const key = this.bucketKey(path, characterId);
    if (key === null) return null;
    const seconds = parseRetryAfter(headers.get('retry-after'), fallbackSeconds);
    const now = Date.now();
    // The group may be known from another character's responses while this
    // character's bucket has never reported its limits. The placeholder's zero
    // window means it is never "low" — only the block holds it — until a
    // response reports the real limits.
    const bucket = this.buckets.get(key) ?? {
      limit: { tokens: 1, windowMs: 0 },
      remaining: 0,
      observedAt: now,
      nextAt: 0,
      blockedUntil: 0,
    };
    bucket.remaining = 0;
    bucket.observedAt = now;
    bucket.blockedUntil = Math.max(bucket.blockedUntil, now + seconds * 1000);
    this.buckets.set(key, bucket);
    return seconds;
  }

  /** Force an app-wide backoff window, e.g. after receiving HTTP 420 (error-limited). */
  forceBackoff(seconds: number): void {
    const until = Date.now() + seconds * 1000;
    if (until > this.backoffUntil) this.backoffUntil = until;
  }

  /**
   * Open an app-wide backoff window from a response's `Retry-After` header (sent
   * with 429, and sometimes 420), falling back to `fallbackSeconds`.
   */
  backoffFromHeaders(headers: Headers, fallbackSeconds: number): void {
    this.forceBackoff(parseRetryAfter(headers.get('retry-after'), fallbackSeconds));
  }
}

export const rateLimiter = new RateLimiter();
