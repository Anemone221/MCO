import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import * as am5 from '@amcharts/amcharts5';
import am5themes_Animated from '@amcharts/amcharts5/themes/Animated';
import { prefersReducedMotion } from '../../lib/motion';

/** The active theme's palette, read from the CSS custom properties. */
export interface ChartPalette {
  accent: string;
  ok: string;
  warn: string;
  danger: string;
  muted: string;
  border: string;
  text: string;
  /** The card surface behind the chart — drawn between stacked segments as a gap. */
  panel: string;
}

function readPalette(): ChartPalette {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string): string => style.getPropertyValue(name).trim();
  return {
    accent: read('--accent'),
    ok: read('--ok'),
    warn: read('--warn'),
    danger: read('--danger'),
    muted: read('--muted'),
    border: read('--border'),
    text: read('--text'),
    panel: read('--panel'),
  };
}

/**
 * Reusable amCharts 5 lifecycle for every dashboard chart: creates the Root
 * on the returned div ref, applies the Animated theme (skipped under
 * reduced motion), hands the builder the active theme's palette, and
 * disposes on unmount. The chart is rebuilt when `dataKey` changes (pass a
 * stable digest of the chart's data — rebuilding replays the entrance
 * animation, which is what a data refresh should feel like) and when the
 * app theme changes (`data-theme` on <html>), so colors always match.
 *
 * ISK-friendly abbreviations (B for billions, not amCharts' default G) are
 * preconfigured on the root's number formatter.
 */
export function useAmChart(
  build: (root: am5.Root, palette: ChartPalette) => void,
  dataKey: string,
): RefObject<HTMLDivElement | null> {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const buildRef = useRef(build);
  buildRef.current = build;
  const [themeTick, setThemeTick] = useState(0);

  useEffect(() => {
    const observer = new MutationObserver(() => setThemeTick((tick) => tick + 1));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const root = am5.Root.new(container);
    if (!prefersReducedMotion()) {
      root.setThemes([am5themes_Animated.new(root)]);
    }
    root.numberFormatter.setAll({
      numberFormat: '#.#a',
      bigNumberPrefixes: [
        { number: 1e3, suffix: 'k' },
        { number: 1e6, suffix: 'M' },
        { number: 1e9, suffix: 'B' },
        { number: 1e12, suffix: 'T' },
      ],
    });
    buildRef.current(root, readPalette());
    return () => root.dispose();
  }, [dataKey, themeTick]);

  return containerRef;
}
