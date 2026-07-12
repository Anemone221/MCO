import { describe, expect, it } from 'vitest';
import { RateLimiter } from '@main/esi/rate-limiter';

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
});

describe('RateLimiter.acquire', () => {
  it('grants and releases slots without deadlocking', async () => {
    const limiter = new RateLimiter();
    for (let i = 0; i < 100; i += 1) {
      await limiter.acquire();
      limiter.release();
    }
    expect(limiter.backoffMs).toBe(0);
  });
});
