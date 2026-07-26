import type { RattedIskDay } from '@shared/types';

/**
 * Pure month-window helpers for the ratted-ISK totals (Dashboard tile) and
 * the by-day series (Wallet chart). Dependency-free so both live in unit
 * tests, per the repo's pure-logic convention.
 */

/** [start, end) ISO bounds of the current UTC calendar month. */
export function currentMonthBoundsUtc(now = new Date()): { start: string; end: string } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start: start.toISOString(), end: end.toISOString() };
}

/**
 * Expand sparse per-day sums into a continuous series from the 1st of the
 * current UTC month through today, zero-filling quiet days so the chart's
 * axis has no gaps.
 */
export function fillMonthDays(sparse: RattedIskDay[], now = new Date()): RattedIskDay[] {
  const byDay = new Map(sparse.map((row) => [row.day, row]));
  const days: RattedIskDay[] = [];
  const pad = (n: number): string => String(n).padStart(2, '0');
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  for (let dayOfMonth = 1; dayOfMonth <= now.getUTCDate(); dayOfMonth += 1) {
    const day = `${year}-${pad(month)}-${pad(dayOfMonth)}`;
    days.push(byDay.get(day) ?? { day, bountyIsk: 0, missionIsk: 0 });
  }
  return days;
}
