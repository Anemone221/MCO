import { describe, expect, it } from 'vitest';
import { parseRetryAfter, RateLimiter } from '@main/esi/rate-limiter';

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
