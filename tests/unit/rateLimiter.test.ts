import { describe, expect, it } from 'vitest';
import { parseRateLimit, parseRetryAfter, RateLimiter, routePattern } from '@main/esi/rate-limiter';

function headers(init: Record<string, string>): Headers {
  return new Headers(init);
}

describe('RateLimiter.observe', () => {
  it('does not back off when the error limit is healthy', () => {
    const limiter = new RateLimiter();
    limiter.observe(headers({ 'x-esi-error-limit-remain': '95', 'x-esi-error-limit-reset': '50' }));
    expect(limiter.backoffMs).toBe(0);
  });

  it('backs off when the error limit is nearly exhausted', () => {
    const limiter = new RateLimiter();
    limiter.observe(headers({ 'x-esi-error-limit-remain': '3', 'x-esi-error-limit-reset': '30' }));
    expect(limiter.backoffMs).toBeGreaterThan(25_000);
    expect(limiter.backoffMs).toBeLessThanOrEqual(30_000);
  });

  it('ignores responses without error-limit headers', () => {
    const limiter = new RateLimiter();
    limiter.observe(headers({}));
    expect(limiter.backoffMs).toBe(0);
  });
});

describe('RateLimiter.forceBackoff', () => {
  it('opens a backoff window of the requested length', () => {
    const limiter = new RateLimiter();
    limiter.forceBackoff(60);
    expect(limiter.backoffMs).toBeGreaterThan(55_000);
  });

  it('only ever extends an existing backoff, never shortens it', () => {
    const limiter = new RateLimiter();
    limiter.forceBackoff(60);
    limiter.forceBackoff(5);
    expect(limiter.backoffMs).toBeGreaterThan(55_000);
  });
});

describe('RateLimiter.backoffFromHeaders', () => {
  it('uses a numeric Retry-After header', () => {
    const limiter = new RateLimiter();
    limiter.backoffFromHeaders(headers({ 'retry-after': '45' }), 60);
    expect(limiter.backoffMs).toBeGreaterThan(40_000);
    expect(limiter.backoffMs).toBeLessThanOrEqual(45_000);
  });

  it('falls back when Retry-After is missing', () => {
    const limiter = new RateLimiter();
    limiter.backoffFromHeaders(headers({}), 60);
    expect(limiter.backoffMs).toBeGreaterThan(55_000);
  });
});

describe('parseRetryAfter', () => {
  it('parses delta-seconds', () => {
    expect(parseRetryAfter('30', 60)).toBe(30);
  });

  it('parses an HTTP-date into remaining seconds', () => {
    const inTen = new Date(Date.now() + 10_000).toUTCString();
    expect(parseRetryAfter(inTen, 60)).toBeGreaterThan(8);
    expect(parseRetryAfter(inTen, 60)).toBeLessThanOrEqual(10);
  });

  it('falls back on null or garbage', () => {
    expect(parseRetryAfter(null, 60)).toBe(60);
    expect(parseRetryAfter('soon', 60)).toBe(60);
  });
});

describe('RateLimiter.acquire', () => {
  it('grants and releases slots without deadlocking (unpaced)', async () => {
    const limiter = new RateLimiter({ minSpacingMs: 0 });
    for (let i = 0; i < 100; i += 1) {
      await limiter.acquire();
      limiter.release();
    }
    expect(limiter.backoffMs).toBe(0);
  });

  it('paces successive dispatches by at least the configured spacing', async () => {
    const spacing = 20;
    const limiter = new RateLimiter({ minSpacingMs: spacing });
    const start = Date.now();
    for (let i = 0; i < 5; i += 1) {
      await limiter.acquire();
      limiter.release();
    }
    // 5 dispatches => 4 inter-dispatch gaps of >= spacing.
    expect(Date.now() - start).toBeGreaterThanOrEqual(4 * spacing - 5);
  });

  it('does not dispatch while a backoff window is open', async () => {
    const limiter = new RateLimiter({ minSpacingMs: 0 });
    limiter.forceBackoff(0.05); // 50 ms
    const start = Date.now();
    await limiter.acquire();
    limiter.release();
    expect(Date.now() - start).toBeGreaterThanOrEqual(45);
  });
});

describe('parseRateLimit', () => {
  it('parses tokens per window in s, m and h', () => {
    expect(parseRateLimit('150/15m')).toEqual({ tokens: 150, windowMs: 15 * 60_000 });
    expect(parseRateLimit('10/1s')).toEqual({ tokens: 10, windowMs: 1000 });
    expect(parseRateLimit('600/1h')).toEqual({ tokens: 600, windowMs: 3_600_000 });
  });

  it('rejects missing or malformed values', () => {
    expect(parseRateLimit(null)).toBeNull();
    expect(parseRateLimit('150')).toBeNull();
    expect(parseRateLimit('150/15d')).toBeNull();
    expect(parseRateLimit('0/15m')).toBeNull();
  });
});

describe('routePattern', () => {
  it('drops ids and the query string', () => {
    expect(routePattern('/characters/123/assets/?page=2')).toBe('/characters/{id}/assets/');
    expect(routePattern('/universe/structures/1035466617946')).toBe('/universe/structures/{id}');
    expect(routePattern('/status/')).toBe('/status/');
  });
});

/** Floating-window headers as ESI sends them on a rate-limited route. */
function bucketHeaders(remaining: number, limit = '20/1s', group = 'char-location'): Headers {
  return headers({
    'x-ratelimit-group': group,
    'x-ratelimit-limit': limit,
    'x-ratelimit-remaining': String(remaining),
  });
}

describe('RateLimiter route buckets', () => {
  it('ignores responses without floating-window headers', () => {
    const limiter = new RateLimiter({ minSpacingMs: 0 });
    expect(limiter.observeRoute('/characters/1/location/', 1, headers({}))).toBeNull();
  });

  it('reports the transition to low once', () => {
    const limiter = new RateLimiter({ minSpacingMs: 0 });
    expect(limiter.observeRoute('/characters/1/location/', 1, bucketHeaders(15))?.becameLow).toBe(false);
    expect(limiter.observeRoute('/characters/1/location/', 1, bucketHeaders(3))?.becameLow).toBe(true);
    expect(limiter.observeRoute('/characters/1/location/', 1, bucketHeaders(2))?.becameLow).toBe(false);
  });

  it('spaces requests to a low bucket at the sustainable rate', async () => {
    const limiter = new RateLimiter({ minSpacingMs: 0 });
    // 20 tokens per 1 s at 2 tokens a request: one request per 100 ms.
    limiter.observeRoute('/characters/1/location/', 1, bucketHeaders(2));
    const start = Date.now();
    for (let i = 0; i < 3; i += 1) {
      await limiter.acquire('/characters/1/location/', 1);
      limiter.release();
    }
    expect(Date.now() - start).toBeGreaterThanOrEqual(2 * 100 - 10);
  });

  it('does not slow a healthy bucket, another character, or another route', async () => {
    const limiter = new RateLimiter({ minSpacingMs: 0 });
    limiter.observeRoute('/characters/1/location/', 1, bucketHeaders(2));
    limiter.observeRoute('/characters/1/online/', 1, bucketHeaders(18, '20/1s', 'char-online'));
    const start = Date.now();
    for (let i = 0; i < 5; i += 1) {
      await limiter.acquire('/characters/2/location/', 2);
      limiter.release();
      await limiter.acquire('/characters/1/online/', 1);
      limiter.release();
      await limiter.acquire('/characters/1/skills/', 1);
      limiter.release();
    }
    expect(Date.now() - start).toBeLessThan(50);
  });

  it('treats a bucket as refilled once a full window has passed', async () => {
    const limiter = new RateLimiter({ minSpacingMs: 0 });
    limiter.observeRoute('/characters/1/location/', 1, bucketHeaders(0, '20/1s'));
    await new Promise((r) => setTimeout(r, 1050));
    const start = Date.now();
    for (let i = 0; i < 3; i += 1) {
      await limiter.acquire('/characters/1/location/', 1);
      limiter.release();
    }
    expect(Date.now() - start).toBeLessThan(50);
  });

  it('blocks only the 429ed bucket, not the whole app', async () => {
    const limiter = new RateLimiter({ minSpacingMs: 0 });
    const blocked = limiter.blockRoute(
      '/characters/1/location/',
      1,
      new Headers({ ...Object.fromEntries(bucketHeaders(0, '20/1m')), 'retry-after': '0.08' }),
      60,
    );
    expect(blocked).toBeCloseTo(0.08);
    expect(limiter.backoffMs).toBe(0);
    expect(limiter.routeBlockedMs('/characters/1/location/', 1)).toBeGreaterThan(0);
    expect(limiter.routeBlockedMs('/characters/2/location/', 2)).toBe(0);

    const other = Date.now();
    await limiter.acquire('/characters/2/location/', 2);
    limiter.release();
    expect(Date.now() - other).toBeLessThan(30);

    const start = Date.now();
    await limiter.acquire('/characters/1/location/', 1);
    limiter.release();
    expect(Date.now() - start).toBeGreaterThanOrEqual(70);
  });

  it('uses a group learned earlier when the 429 itself has no headers', () => {
    const limiter = new RateLimiter({ minSpacingMs: 0 });
    limiter.observeRoute('/characters/1/location/', 1, bucketHeaders(10));
    expect(limiter.blockRoute('/characters/7/location/', 7, headers({ 'retry-after': '5' }), 60)).toBe(5);
    expect(limiter.routeBlockedMs('/characters/7/location/', 7)).toBeGreaterThan(4000);
  });

  it('returns null for a 429 on a route with no known group', () => {
    const limiter = new RateLimiter({ minSpacingMs: 0 });
    expect(limiter.blockRoute('/characters/1/wallet/', 1, headers({ 'retry-after': '5' }), 60)).toBeNull();
  });
});
