import { describe, expect, it } from 'vitest';
import type { RattedIskDay } from '@shared/types';
import { currentMonthBoundsUtc, fillMonthDays } from '@main/wallet/monthIncome';

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
    expect(filled.every((d) => d.bountyIsk === 0 && d.missionIsk === 0)).toBe(true);
  });

  it('keeps sums for days present and zero-fills the rest', () => {
    const sparse: RattedIskDay[] = [
      { day: '2026-07-02', bountyIsk: 100, missionIsk: 20 },
      { day: '2026-07-04', bountyIsk: 50, missionIsk: 0 },
    ];
    const filled = fillMonthDays(sparse, NOW);
    expect(filled).toEqual([
      { day: '2026-07-01', bountyIsk: 0, missionIsk: 0 },
      { day: '2026-07-02', bountyIsk: 100, missionIsk: 20 },
      { day: '2026-07-03', bountyIsk: 0, missionIsk: 0 },
      { day: '2026-07-04', bountyIsk: 50, missionIsk: 0 },
      { day: '2026-07-05', bountyIsk: 0, missionIsk: 0 },
    ]);
  });

  it('ignores rows outside the current month', () => {
    const sparse: RattedIskDay[] = [{ day: '2026-06-30', bountyIsk: 999, missionIsk: 999 }];
    const filled = fillMonthDays(sparse, NOW);
    expect(filled.some((d) => d.bountyIsk === 999)).toBe(false);
    expect(filled).toHaveLength(5);
  });
});
