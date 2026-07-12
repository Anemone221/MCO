import { describe, expect, it } from 'vitest';
import {
  formatBytes,
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
    const future = new Date(Date.now() + 3 * 86_400_000 + 4 * 3_600_000).toISOString();
    expect(formatTimeUntil(future)).toBe('in 3d 4h');
  });
});
