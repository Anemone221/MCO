import { describe, expect, it } from 'vitest';
import { classifyCharacterSync } from '@main/sync/characterSyncState';

const NOW = new Date('2026-07-16T12:00:00Z').getTime();
const PAST = '2026-07-16T11:00:00Z';
const FUTURE = '2026-07-16T13:00:00Z';

describe('classifyCharacterSync', () => {
  it('reports login-expired above everything else', () => {
    expect(
      classifyCharacterSync({
        refreshedAt: PAST,
        cacheExpiresAt: FUTURE,
        tokenInvalid: true,
        nowMs: NOW,
      }),
    ).toBe('login-expired');
  });

  it('reports never-synced when the character has no completed sync', () => {
    expect(
      classifyCharacterSync({
        refreshedAt: null,
        cacheExpiresAt: null,
        tokenInvalid: false,
        nowMs: NOW,
      }),
    ).toBe('never-synced');
  });

  it('reports ok while the skills cache is still fresh', () => {
    expect(
      classifyCharacterSync({
        refreshedAt: PAST,
        cacheExpiresAt: FUTURE,
        tokenInvalid: false,
        nowMs: NOW,
      }),
    ).toBe('ok');
  });

  it('reports due once the cache window has lapsed', () => {
    expect(
      classifyCharacterSync({
        refreshedAt: PAST,
        cacheExpiresAt: PAST,
        tokenInvalid: false,
        nowMs: NOW,
      }),
    ).toBe('due');
  });

  it('reports due when synced but the cache entry is missing or unparsable', () => {
    for (const cacheExpiresAt of [null, 'not-a-date']) {
      expect(
        classifyCharacterSync({
          refreshedAt: PAST,
          cacheExpiresAt,
          tokenInvalid: false,
          nowMs: NOW,
        }),
      ).toBe('due');
    }
  });
});
