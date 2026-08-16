import type { WalletSummary } from '@shared/types';
import {
  sumWalletTotalsBetween,
  sumWalletTotalsByDay,
  sumWalletTotalsByMonth,
} from '../db/repositories/characterWalletJournal';
import {
  currentMonthBoundsUtc,
  fillMonthDays,
  previousMonthsBoundsUtc,
} from '../wallet/monthIncome';

/**
 * How far back the previous-months view looks. A year is enough to read a
 * season off the chart while keeping the axis legible; there is nothing older
 * to show anyway until MCO has been running that long.
 */
const HISTORY_MONTHS = 12;

/** Current-month totals, the by-day series, and the months before it (Wallet page). */
export function buildWalletSummary(): WalletSummary {
  const { start, end } = currentMonthBoundsUtc();
  const history = previousMonthsBoundsUtc(HISTORY_MONTHS);
  return {
    totals: sumWalletTotalsBetween(start, end),
    byDay: fillMonthDays(sumWalletTotalsByDay(start, end)),
    previousMonths: sumWalletTotalsByMonth(history.start, history.end),
  };
}
