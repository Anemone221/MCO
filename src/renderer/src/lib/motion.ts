/**
 * Shared motion helpers. The easing/interpolation functions are pure (unit-
 * tested); `prefersReducedMotion` is the JS-side twin of the global
 * prefers-reduced-motion CSS block in styles.css — rAF-driven animations
 * (count-ups, carousel drift) check it and skip straight to the end state.
 */

/**
 * Structural probe instead of `window`: this module is imported by unit
 * tests, which type-check under the node tsconfig (no DOM lib).
 */
interface MatchMediaHost {
  matchMedia?: (query: string) => { matches: boolean };
}

export function prefersReducedMotion(): boolean {
  try {
    return (globalThis as MatchMediaHost).matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  } catch {
    return false;
  }
}

/** Ease-out cubic: fast start, gentle settle. t in [0, 1]. */
export function easeOutCubic(t: number): number {
  const clamped = Math.min(Math.max(t, 0), 1);
  return 1 - Math.pow(1 - clamped, 3);
}

/** Eased value between two counts at progress t in [0, 1]. */
export function interpolateCount(from: number, to: number, t: number): number {
  return from + (to - from) * easeOutCubic(t);
}
