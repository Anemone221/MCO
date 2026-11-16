import { vi } from 'vitest';

/**
 * The ESI client spaces its requests ~120 ms apart so a 90-character sweep
 * trickles out instead of bursting. Against a fake ESI that spacing is only
 * waiting, so the suite runs with the pacer off; everything else about the
 * limiter (the concurrency cap, backoff windows) is the real thing.
 */
vi.mock('@main/esi/rate-limiter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@main/esi/rate-limiter')>();
  return { ...actual, rateLimiter: new actual.RateLimiter({ minSpacingMs: 0 }) };
});
