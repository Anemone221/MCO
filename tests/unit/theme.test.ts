import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME, normalizeTheme, THEMES } from '@renderer/lib/theme';

describe('normalizeTheme', () => {
  it('accepts every declared theme id', () => {
    for (const theme of THEMES) {
      expect(normalizeTheme(theme.id)).toBe(theme.id);
    }
  });

  it('falls back to the default for unknown or absent values', () => {
    expect(normalizeTheme(null)).toBe(DEFAULT_THEME);
    expect(normalizeTheme(undefined)).toBe(DEFAULT_THEME);
    expect(normalizeTheme('')).toBe(DEFAULT_THEME);
    expect(normalizeTheme('solarized')).toBe(DEFAULT_THEME);
  });
});
