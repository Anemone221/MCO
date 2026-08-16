import { describe, expect, it } from 'vitest';
import {
  formatBytes,
  formatDuration,
  formatIsk,
  formatIskShort,
  formatMonthLabel,
  formatSp,
  formatTimeUntil,
  romanLevel,
} from '@renderer/lib/format';

describe('formatSp', () => {
  it('formats millions, thousands and small values', () => {
    expect(formatSp(12_300_000)).toBe('12.3M SP');
    expect(formatSp(45_000)).toBe('45k SP');
    expect(formatSp(512)).toBe('512 SP');
  });

  it('formats billions (a 90+ character roster combined)', () => {
    expect(formatSp(43_150_500_000)).toBe('43.15B SP');
  });
});

describe('formatIsk', () => {
  it('formats billions, millions, thousands and small balances', () => {
    expect(formatIsk(1_234_000_000)).toBe('1.23B ISK');
    expect(formatIsk(45_600_000)).toBe('45.6M ISK');
    expect(formatIsk(789_000)).toBe('789k ISK');
    expect(formatIsk(123.45)).toBe('123 ISK');
  });

  it('formats trillions (a whale wallet)', () => {
    expect(formatIsk(1_450_000_000_000)).toBe('1.45T ISK');
  });

  it('keeps the sign on a negative balance', () => {
    expect(formatIsk(-2_500_000)).toBe('-2.5M ISK');
  });
});

describe('formatIskShort', () => {
  it('abbreviates without the unit, for breakdown lines under a labelled figure', () => {
    expect(formatIskShort(1_234_000_000)).toBe('1.23B');
    expect(formatIskShort(810_000_000)).toBe('810.0M');
    expect(formatIskShort(0)).toBe('0');
    expect(formatIskShort(-2_500_000)).toBe('-2.5M');
  });
});

describe('formatMonthLabel', () => {
  it('turns a YYYY-MM key into a short month label', () => {
    expect(formatMonthLabel('2026-02')).toBe('Feb 2026');
    expect(formatMonthLabel('2025-12')).toBe('Dec 2025');
  });

  it('falls back to the raw key rather than inventing a month', () => {
    expect(formatMonthLabel('2026-13')).toBe('2026-13');
  });
});

describe('romanLevel', () => {
  it('maps skill levels to roman numerals', () => {
    expect(romanLevel(0)).toBe('0');
    expect(romanLevel(1)).toBe('I');
    expect(romanLevel(5)).toBe('V');
  });
});

describe('formatBytes', () => {
  it('formats megabytes, kilobytes and bytes', () => {
    expect(formatBytes(85_000_000)).toBe('81.1 MB');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(64)).toBe('64 B');
  });
});

describe('formatTimeUntil', () => {
  it('returns "—" for null and "done" for past timestamps', () => {
    expect(formatTimeUntil(null)).toBe('—');
    expect(formatTimeUntil(new Date(Date.now() - 1000).toISOString())).toBe('done');
  });

  it('formats a future timestamp as a relative duration', () => {
    // 30s of slack, because formatTimeUntil floors to whole minutes: on an exact
    // 3d4h target, a single millisecond ticking over between building the
    // timestamp and reading the clock inside the formatter drops it to "3d 3h".
    const future = new Date(Date.now() + 3 * 86_400_000 + 4 * 3_600_000 + 30_000).toISOString();
    expect(formatTimeUntil(future)).toBe('in 3d 4h');
  });
});

describe('formatDuration', () => {
  it('formats days, hours and minutes', () => {
    expect(formatDuration(20_340)).toBe('14d 3h');
    expect(formatDuration(192)).toBe('3h 12m');
    expect(formatDuration(45)).toBe('45m');
  });

  it('handles sub-minute, zero and invalid spans', () => {
    expect(formatDuration(0.4)).toBe('<1m');
    expect(formatDuration(0)).toBe('0m');
    expect(formatDuration(-5)).toBe('—');
    expect(formatDuration(Number.NaN)).toBe('—');
  });
});
