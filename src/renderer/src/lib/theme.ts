/**
 * Theme definitions: each theme is a set of CSS custom-property overrides in
 * styles.css keyed off `data-theme` on <html>. This module is DOM-free (lib
 * modules unit-test under node); applying/persisting lives in ../theme.ts.
 */
export const THEMES = [
  { id: 'dark', label: 'Dark', description: 'The default — graphite panels, blue accent.' },
  { id: 'holo', label: 'Holo', description: 'Sci-fi HUD — glowing cyan on deep space.' },
  { id: 'light', label: 'Light', description: 'Bright panels for daytime use.' },
  { id: 'void', label: 'Void', description: 'Pure-black background for OLED screens.' },
  { id: 'amber', label: 'Amber', description: 'Dark with a gold accent, EVE hangar style.' },
] as const;

export type ThemeId = (typeof THEMES)[number]['id'];

export const DEFAULT_THEME: ThemeId = 'dark';

export const THEME_STORAGE_KEY = 'mco-theme';

/** Coerce a stored/unknown value to a valid theme id, falling back to the default. */
export function normalizeTheme(value: string | null | undefined): ThemeId {
  return THEMES.some((t) => t.id === value) ? (value as ThemeId) : DEFAULT_THEME;
}
