import { describe, expect, it } from 'vitest';
import type { MiningDayTotals } from '@shared/types';
import { dayKeyUtc, fillMiningDays, miningWindowUtc, shiftDay } from '@main/mining/window';

/** A fixed "now": mid-afternoon UTC, so nothing here depends on the clock. */
const NOW = new Date('2026-08-20T14:30:00Z');

const day = (day: string, volumeM3: number): MiningDayTotals => ({ day, units: 1, volumeM3 });

describe('dayKeyUtc', () => {
  it('reads the UTC day, not the local one', () => {
    // 23:30 UTC on the 20th is already the 21st in +02:00 — the ledger's day
    // is ESI's, so the key must not follow the machine's timezone.
    expect(dayKeyUtc(new Date('2026-08-20T23:30:00Z'))).toBe('2026-08-20');
  });
});

describe('shiftDay', () => {
  it('steps backwards across a month boundary', () => {
    expect(shiftDay('2026-08-02', -3)).toBe('2026-07-30');
  });

  it('steps forwards across a year boundary', () => {
    expect(shiftDay('2025-12-31', 1)).toBe('2026-01-01');
  });

  it('handles a leap day', () => {
    expect(shiftDay('2028-03-01', -1)).toBe('2028-02-29');
  });
});

describe('miningWindowUtc', () => {
  it('counts today as day one', () => {
    expect(miningWindowUtc(1, NOW)).toEqual({
      startDay: '2026-08-20',
      endDay: '2026-08-20',
      days: 1,
    });
  });

  it('includes today in a multi-day window', () => {
    // 7 days = today and the six before it, not today plus seven.
    expect(miningWindowUtc(7, NOW)).toEqual({
      startDay: '2026-08-14',
      endDay: '2026-08-20',
      days: 7,
    });
  });

  it('reaches back before anything the ledger can hold when unbounded', () => {
    const window = miningWindowUtc(null, NOW);

    expect(window.days).toBeNull();
    expect(window.endDay).toBe('2026-08-20');
    expect(window.startDay < '2003-05-06').toBe(true);
  });

  it('never returns an empty window', () => {
    expect(miningWindowUtc(0, NOW).startDay).toBe('2026-08-20');
  });
});

describe('fillMiningDays', () => {
  it('zero-fills the days nobody undocked', () => {
    const filled = fillMiningDays(miningWindowUtc(4, NOW), [
      day('2026-08-18', 500),
      day('2026-08-20', 900),
    ]);

    expect(filled.map((d) => [d.day, d.volumeM3])).toEqual([
      ['2026-08-17', 0],
      ['2026-08-18', 500],
      ['2026-08-19', 0],
      ['2026-08-20', 900],
    ]);
  });

  it('starts an unbounded window at its first row, not at the year zero', () => {
    const filled = fillMiningDays(miningWindowUtc(null, NOW), [day('2026-08-19', 100)]);

    expect(filled).toHaveLength(2);
    expect(filled[0]?.day).toBe('2026-08-19');
    expect(filled[1]).toMatchObject({ day: '2026-08-20', volumeM3: 0 });
  });

  it('is empty when an unbounded window has nothing recorded', () => {
    expect(fillMiningDays(miningWindowUtc(null, NOW), [])).toEqual([]);
  });

  it('still spans a bounded window with no activity at all', () => {
    const filled = fillMiningDays(miningWindowUtc(3, NOW), []);

    expect(filled).toHaveLength(3);
    expect(filled.every((d) => d.volumeM3 === 0 && d.units === 0)).toBe(true);
  });
});
