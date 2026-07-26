/**
 * Respects ESI's error-limit window, paces request dispatch, and bounds request
 * concurrency. See https://developers.eveonline.com/docs/services/esi/rate-limiting/
 *
 * Three cooperating controls:
 *  - **Concurrency cap** — at most `maxConcurrency` requests in flight, a ceiling
 *    on burst width.
 *  - **Dispatch pacer** — a minimum spacing between successive request starts, so a
 *    "sweep" of 90+ characters trickles out at a steady rate instead of firing as
 *    fast as ESI can answer. This is what keeps us clear of the error cascade a
 *    burst provokes and is the "offset requests" behaviour a large fleet needs.
 *  - **Backoff window** — a hard pause for everyone after a 420 (legacy error
 *    limit) or 429 (new floating-window bucket), honoured before any dispatch.
 */

const DEFAULT_MAX_CONCURRENCY = 20;
/** ~8 requests/second steady-state — gentle, and drains a full-fleet sweep in ~2 min. */
const DEFAULT_MIN_SPACING_MS = 120;
const ERROR_LIMIT_FLOOR = 10;

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

export class RateLimiter {
  private active = 0;
  private readonly waiters: Array<() => void> = [];
  private backoffUntil = 0;
  /** Earliest wall-clock time the next request may be dispatched (pacer cursor). */
  private nextDispatchAt = 0;
  private readonly maxConcurrency: number;
  private readonly minSpacingMs: number;

  constructor(options: RateLimiterOptions = {}) {
    this.maxConcurrency = options.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY;
    this.minSpacingMs = options.minSpacingMs ?? DEFAULT_MIN_SPACING_MS;
  }

  /** Milliseconds remaining in the current error-limit backoff window (0 when clear). */
  get backoffMs(): number {
    return Math.max(0, this.backoffUntil - Date.now());
  }

  /** Acquire a concurrency slot, then wait for this request's paced dispatch turn. */
  async acquire(): Promise<void> {
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

  /** Update backoff state from an ESI response's error-limit headers. */
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

  /** Force a backoff window, e.g. after receiving HTTP 420 (error-limited). */
  forceBackoff(seconds: number): void {
    const until = Date.now() + seconds * 1000;
    if (until > this.backoffUntil) this.backoffUntil = until;
  }

  /**
   * Open a backoff window from a response's `Retry-After` header (sent with 429,
   * and sometimes 420), falling back to `fallbackSeconds`.
   */
  backoffFromHeaders(headers: Headers, fallbackSeconds: number): void {
    this.forceBackoff(parseRetryAfter(headers.get('retry-after'), fallbackSeconds));
  }
}

export const rateLimiter = new RateLimiter();
