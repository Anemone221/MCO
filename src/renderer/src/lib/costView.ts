import { formatDuration, formatSp } from './format';

/** How a fit/plan measures what a character still needs: raw SP, injectors, or train time. */
export type CostSystem = 'sp' | 'lsi' | 'time';

export interface CostThresholds {
  sp: number;
  lsi: number;
  timeDays: number;
}

export interface CostView {
  system: CostSystem;
  thresholds: CostThresholds;
}

export const DEFAULT_COST_VIEW: CostView = {
  system: 'sp',
  thresholds: { sp: 500_000, lsi: 1, timeDays: 7 },
};

const STORAGE_KEY = 'mco.costView';

const isSystem = (value: unknown): value is CostSystem =>
  value === 'sp' || value === 'lsi' || value === 'time';

const sanitizeThreshold = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;

function sanitize(value: unknown): CostView {
  const raw = (value ?? {}) as Partial<CostView>;
  const thresholds = (raw.thresholds ?? {}) as Partial<CostThresholds>;
  const defaults = DEFAULT_COST_VIEW.thresholds;
  return {
    system: isSystem(raw.system) ? raw.system : DEFAULT_COST_VIEW.system,
    thresholds: {
      sp: sanitizeThreshold(thresholds.sp, defaults.sp),
      lsi: sanitizeThreshold(thresholds.lsi, defaults.lsi),
      timeDays: sanitizeThreshold(thresholds.timeDays, defaults.timeDays),
    },
  };
}

/**
 * Cost system + thresholds for one fit/plan. Persisted per entity in
 * localStorage; missing or corrupt storage yields the defaults.
 */
export function loadCostView(kind: 'fit' | 'plan', id: number): CostView {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_COST_VIEW;
    const stored = JSON.parse(raw) as Record<string, unknown>;
    const entry = stored[`${kind}:${id}`];
    if (entry === undefined) return DEFAULT_COST_VIEW;
    return sanitize(entry);
  } catch {
    return DEFAULT_COST_VIEW;
  }
}

export function saveCostView(kind: 'fit' | 'plan', id: number, view: CostView): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const stored = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    stored[`${kind}:${id}`] = view;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Persistence is best-effort; ignore quota/availability failures.
  }
}

/** The gap fields every analysis result row carries. */
export interface CostMetrics {
  spGap: number;
  lsiGap: number;
  timeGapMinutes: number | null;
}

/** The selected system's metric for a row; null only for time without data. */
export function costMetric(system: CostSystem, c: CostMetrics): number | null {
  if (system === 'sp') return c.spGap;
  if (system === 'lsi') return c.lsiGap;
  return c.timeGapMinutes;
}

/** The active threshold in the selected metric's own unit (time: days -> minutes). */
export function activeThreshold(view: CostView): number {
  if (view.system === 'sp') return view.thresholds.sp;
  if (view.system === 'lsi') return view.thresholds.lsi;
  return view.thresholds.timeDays * 1440;
}

/** A row's remaining cost in the selected system, e.g. "412k SP" / "2 injectors" / "14d 3h". */
export function formatCost(system: CostSystem, c: CostMetrics): string {
  if (system === 'sp') return formatSp(c.spGap);
  if (system === 'lsi') return c.lsiGap === 1 ? '1 injector' : `${c.lsiGap} injectors`;
  return c.timeGapMinutes === null ? '—' : formatDuration(c.timeGapMinutes);
}

/** The threshold value for bucket headings, e.g. "500k SP" / "2 injectors" / "7d 0h". */
export function formatThresholdLabel(view: CostView): string {
  if (view.system === 'sp') return formatSp(view.thresholds.sp);
  if (view.system === 'lsi')
    return view.thresholds.lsi === 1 ? '1 injector' : `${view.thresholds.lsi} injectors`;
  return formatDuration(view.thresholds.timeDays * 1440);
}

/** Near/far ordering: metric ascending, unknown time last, SP gap as tiebreak. */
export function compareByCost(system: CostSystem, a: CostMetrics, b: CostMetrics): number {
  const ma = costMetric(system, a);
  const mb = costMetric(system, b);
  if (ma === null && mb === null) return a.spGap - b.spGap;
  if (ma === null) return 1;
  if (mb === null) return -1;
  return ma - mb || a.spGap - b.spGap;
}
