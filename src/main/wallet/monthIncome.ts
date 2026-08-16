import type { WalletDayTotals } from '@shared/types';

/**
 * Pure month-window helpers for the wallet totals (Dashboard tile, Wallet
 * cards), the by-day series (Wallet chart) and the previous-months history.
 * Dependency-free so they all live in unit tests, per the repo's pure-logic
 * convention.
 */

/** [start, end) ISO bounds of the current UTC calendar month. */
export function currentMonthBoundsUtc(now = new Date()): { start: string; end: string } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start: start.toISOString(), end: end.toISOString() };
}

/**
 * [start, end) ISO bounds of the `months` completed calendar months before the
 * current one — the window the Wallet page's previous-months view reads. It
 * ends where the current month begins, so the month in progress is never mixed
 * in with finished ones.
 */
export function previousMonthsBoundsUtc(
  months: number,
  now = new Date(),
): { start: string; end: string } {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, 1));
  return { start: start.toISOString(), end: end.toISOString() };
}

/** A day with no journal activity at all: every tracked category at zero. */
function emptyDay(day: string): WalletDayTotals {
  return {
    day,
    income: { bountyIsk: 0, missionIsk: 0, corpRewardIsk: 0, totalIsk: 0 },
    taxIsk: 0,
    expenseIsk: 0,
    donationsInIsk: 0,
    donationsOutIsk: 0,
    internalTransferIsk: 0,
  };
}

/**
 * Expand sparse per-day totals into a continuous series from the 1st of the
 * current UTC month through today, zero-filling quiet days so the chart's
 * axis has no gaps.
 */
export function fillMonthDays(
  sparse: WalletDayTotals[],
  now = new Date(),
): WalletDayTotals[] {
  const byDay = new Map(sparse.map((row) => [row.day, row]));
  const days: WalletDayTotals[] = [];
  const pad = (n: number): string => String(n).padStart(2, '0');
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  for (let dayOfMonth = 1; dayOfMonth <= now.getUTCDate(); dayOfMonth += 1) {
    const day = `${year}-${pad(month)}-${pad(dayOfMonth)}`;
    days.push(byDay.get(day) ?? emptyDay(day));
  }
  return days;
}
