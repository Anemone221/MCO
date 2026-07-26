import { describe, expect, it } from 'vitest';
import { isStructureDue } from '@main/structures/refreshPolicy';

describe('isStructureDue', () => {
  const now = new Date('2026-07-16T12:00:00.000Z');
  const hoursAgo = (h: number): string =>
    new Date(now.getTime() - h * 3_600_000).toISOString();

  it('is due when the structure has never been seen', () => {
    expect(isStructureDue(undefined, now)).toBe(true);
  });

  it('is due when the row has no attempt stamps at all', () => {
    expect(isStructureDue({ resolvedAt: null, failedAt: null }, now)).toBe(true);
  });

  it('is not due shortly after a successful resolve', () => {
    expect(isStructureDue({ resolvedAt: hoursAgo(1), failedAt: null }, now)).toBe(false);
  });

  it('is due once a resolved structure is older than a week', () => {
    expect(isStructureDue({ resolvedAt: hoursAgo(6 * 24), failedAt: null }, now)).toBe(false);
    expect(isStructureDue({ resolvedAt: hoursAgo(8 * 24), failedAt: null }, now)).toBe(true);
  });

  it('throttles failed lookups to a daily retry', () => {
    expect(isStructureDue({ resolvedAt: null, failedAt: hoursAgo(1) }, now)).toBe(false);
    expect(isStructureDue({ resolvedAt: null, failedAt: hoursAgo(25) }, now)).toBe(true);
  });

  it('uses the failure cadence when the failure is more recent than the resolve', () => {
    // Resolved long ago, failed again recently (lost docking access): daily retry.
    expect(
      isStructureDue({ resolvedAt: hoursAgo(30 * 24), failedAt: hoursAgo(2) }, now),
    ).toBe(false);
    expect(
      isStructureDue({ resolvedAt: hoursAgo(30 * 24), failedAt: hoursAgo(26) }, now),
    ).toBe(true);
  });

  it('uses the weekly cadence when the resolve is more recent than an old failure', () => {
    expect(
      isStructureDue({ resolvedAt: hoursAgo(2), failedAt: hoursAgo(48) }, now),
    ).toBe(false);
    expect(
      isStructureDue({ resolvedAt: hoursAgo(8 * 24), failedAt: hoursAgo(30 * 24) }, now),
    ).toBe(true);
  });
});
