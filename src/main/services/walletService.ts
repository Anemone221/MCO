import type { WalletSummary } from '@shared/types';
import { sumIncomeBetween, sumIncomeByDayBetween } from '../db/repositories/characterWalletJournal';
import { currentMonthBoundsUtc, fillMonthDays } from '../wallet/monthIncome';

/** Ratted-income totals and per-day series for the current UTC month (Wallet page). */
export function buildWalletSummary(): WalletSummary {
  const { start, end } = currentMonthBoundsUtc();
  return {
    rattedIsk: sumIncomeBetween(start, end),
    rattedIskByDay: fillMonthDays(sumIncomeByDayBetween(start, end)),
  };
}
