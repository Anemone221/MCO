/**
 * Respects ESI's error-limit window and bounds request concurrency.
 * See https://developers.eveonline.com/docs/services/esi/rate-limiting/
 */

const MAX_CONCURRENCY = 20;
const ERROR_LIMIT_FLOOR = 10;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export class RateLimiter {
  private active = 0;
  private readonly waiters: Array<() => void> = [];
  private backoffUntil = 0;

  /** Milliseconds remaining in the current error-limit backoff window (0 when clear). */
  get backoffMs(): number {
    return Math.max(0, this.backoffUntil - Date.now());
  }

  /** Acquire a concurrency slot, waiting through any active error-limit backoff. */
  async acquire(): Promise<void> {
    if (this.active >= MAX_CONCURRENCY) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    this.active += 1;

    const wait = this.backoffUntil - Date.now();
    if (wait > 0) await sleep(wait);
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
    this.backoffUntil = Date.now() + seconds * 1000;
  }
}

export const rateLimiter = new RateLimiter();
