import type { MiningDayTotals } from '@shared/types';

/**
 * Pure day-window helpers for the mining ledger. The ledger's grain is a UTC
 * calendar day (that is how ESI aggregates it), so its windows are day keys —
 * `YYYY-MM-DD` strings, compared as strings, which sort exactly as dates do.
 *
 * Dependency-free, per the repo's pure-logic convention: the rules that decide
 * what a window covers are unit-tested without a DB or Electron.
 */

/** Inclusive `[startDay, endDay]` UTC day keys. */
export interface MiningWindow {
  startDay: string;
  endDay: string;
  /** How many days were asked for; null for "everything recorded". */
  days: number | null;
}

/** The UTC calendar day a date falls on, as a `YYYY-MM-DD` key. */
export function dayKeyUtc(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * The day key `offset` days before `day`. String in, string out: the ledger
 * never holds a time of day, so the arithmetic happens at noon UTC where no
 * rounding or DST question can reach it.
 */
export function shiftDay(day: string, offset: number): string {
  const at = new Date(`${day}T12:00:00Z`);
  at.setUTCDate(at.getUTCDate() + offset);
  return dayKeyUtc(at);
}

/**
 * The window the page asks for: the last `days` UTC days **including today**
 * (so 1 = today, 7 = today and the six days before it). `days` null means
 * everything banked, which is bounded below by a key older than any ledger row
 * rather than by a magic empty string — the same comparison then serves both.
 */
export function miningWindowUtc(days: number | null, now = new Date()): MiningWindow {
  const endDay = dayKeyUtc(now);
  if (days === null) return { startDay: '0000-01-01', endDay, days: null };
  const span = Math.max(1, Math.floor(days));
  return { startDay: shiftDay(endDay, -(span - 1)), endDay, days: span };
}

/** A day nobody mined on. */
function emptyDay(day: string): MiningDayTotals {
  return { day, units: 0, volumeM3: 0 };
}

/**
 * Expand sparse per-day totals into a continuous series across the window, so
 * the chart's axis has no gaps where nobody undocked.
 *
 * An unbounded window ("everything recorded") is filled from its first row
 * instead of from the year zero the window nominally starts at — otherwise a
 * quiet profile would zero-fill two millennia of columns.
 */
export function fillMiningDays(window: MiningWindow, sparse: MiningDayTotals[]): MiningDayTotals[] {
  const first = window.days === null ? sparse[0]?.day : window.startDay;
  if (first === undefined) return [];

  const byDay = new Map(sparse.map((row) => [row.day, row]));
  const days: MiningDayTotals[] = [];
  for (let day = first; day <= window.endDay; day = shiftDay(day, 1)) {
    days.push(byDay.get(day) ?? emptyDay(day));
  }
  return days;
}
