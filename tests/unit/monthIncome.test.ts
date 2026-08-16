import { describe, expect, it } from 'vitest';
import type { WalletDayTotals } from '@shared/types';
import {
  currentMonthBoundsUtc,
  fillMonthDays,
  previousMonthsBoundsUtc,
} from '@main/wallet/monthIncome';

/** A day's totals with only the categories a case cares about set. */
function day(dayIso: string, overrides: Partial<WalletDayTotals> = {}): WalletDayTotals {
  return {
    day: dayIso,
    income: { bountyIsk: 0, missionIsk: 0, corpRewardIsk: 0, totalIsk: 0 },
    taxIsk: 0,
    expenseIsk: 0,
    donationsInIsk: 0,
    donationsOutIsk: 0,
    internalTransferIsk: 0,
    ...overrides,
  };
}

describe('currentMonthBoundsUtc', () => {
  it('spans the 1st of the month to the 1st of the next, in UTC', () => {
    const { start, end } = currentMonthBoundsUtc(new Date('2026-07-24T13:00:00Z'));
    expect(start).toBe('2026-07-01T00:00:00.000Z');
    expect(end).toBe('2026-08-01T00:00:00.000Z');
  });

  it('rolls the year over in December', () => {
    const { start, end } = currentMonthBoundsUtc(new Date('2026-12-15T00:00:00Z'));
    expect(start).toBe('2026-12-01T00:00:00.000Z');
    expect(end).toBe('2027-01-01T00:00:00.000Z');
  });
});

describe('previousMonthsBoundsUtc', () => {
  it('ends where the current month starts, so the month in progress is excluded', () => {
    const { start, end } = previousMonthsBoundsUtc(12, new Date('2026-07-24T13:00:00Z'));
    expect(start).toBe('2025-07-01T00:00:00.000Z');
    expect(end).toBe('2026-07-01T00:00:00.000Z');
  });

  it('rolls the year back across January', () => {
    const { start, end } = previousMonthsBoundsUtc(3, new Date('2026-01-09T22:00:00Z'));
    expect(start).toBe('2025-10-01T00:00:00.000Z');
    expect(end).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('fillMonthDays', () => {
  const NOW = new Date('2026-07-05T09:00:00Z');

  it('emits one entry per day from the 1st through today', () => {
    const filled = fillMonthDays([], NOW);
    expect(filled.map((d) => d.day)).toEqual([
      '2026-07-01',
      '2026-07-02',
      '2026-07-03',
      '2026-07-04',
      '2026-07-05',
    ]);
    expect(filled.every((d) => d.income.totalIsk === 0 && d.taxIsk === 0)).toBe(true);
  });

  it('keeps sums for days present and zero-fills the rest', () => {
    const busy = day('2026-07-02', {
      income: { bountyIsk: 100, missionIsk: 20, corpRewardIsk: 5, totalIsk: 125 },
      taxIsk: 11,
    });
    const quiet = day('2026-07-04', {
      income: { bountyIsk: 50, missionIsk: 0, corpRewardIsk: 0, totalIsk: 50 },
    });
    const filled = fillMonthDays([busy, quiet], NOW);
    expect(filled).toEqual([
      day('2026-07-01'),
      busy,
      day('2026-07-03'),
      quiet,
      day('2026-07-05'),
    ]);
  });

  it('zero-fills every outgoing category too, not just income', () => {
    const filled = fillMonthDays([], NOW);
    expect(filled[0]).toEqual(day('2026-07-01'));
  });

  it('ignores rows outside the current month', () => {
    const sparse = [
      day('2026-06-30', {
        income: { bountyIsk: 999, missionIsk: 999, corpRewardIsk: 0, totalIsk: 1998 },
      }),
    ];
    const filled = fillMonthDays(sparse, NOW);
    expect(filled.some((d) => d.income.totalIsk === 1998)).toBe(false);
    expect(filled).toHaveLength(5);
  });
});
