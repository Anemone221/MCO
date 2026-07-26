import { normalizeTheme, THEME_STORAGE_KEY, type ThemeId } from './lib/theme';

/**
 * Theme switching. The choice persists in localStorage (a renderer-only
 * display preference, so no IPC round-trip) and is applied synchronously at
 * startup to avoid a flash of the wrong theme.
 */
export function getStoredTheme(): ThemeId {
  try {
    return normalizeTheme(localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return normalizeTheme(null);
  }
}

/** Apply a theme to the document and persist it. */
export function applyTheme(theme: ThemeId): void {
  document.documentElement.dataset['theme'] = theme;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // storage unavailable — theme still applies for this session
  }
}

/** Apply the persisted theme; call once at startup before first render. */
export function initTheme(): void {
  document.documentElement.dataset['theme'] = getStoredTheme();
}
