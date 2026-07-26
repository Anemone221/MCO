import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_COST_VIEW,
  activeThreshold,
  compareByCost,
  costMetric,
  formatCost,
  formatThresholdLabel,
  loadCostView,
  saveCostView,
  type CostMetrics,
  type CostView,
} from '@renderer/lib/costView';

const view = (overrides: Partial<CostView> = {}): CostView => ({
  ...DEFAULT_COST_VIEW,
  ...overrides,
});

const metrics = (overrides: Partial<CostMetrics> = {}): CostMetrics => ({
  spGap: 100_000,
  lsiGap: 1,
  timeGapMinutes: 300,
  ...overrides,
});

describe('cost view persistence', () => {
  // Minimal in-memory localStorage stub (the unit env is 'node').
  const store = new Map<string, string>();
  const stub = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };

  beforeEach(() => {
    store.clear();
    (globalThis as { localStorage?: unknown }).localStorage = stub;
  });

  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it('defaults when nothing is stored or localStorage is unavailable', () => {
    expect(loadCostView('fit', 1)).toEqual(DEFAULT_COST_VIEW);
    delete (globalThis as { localStorage?: unknown }).localStorage;
    expect(loadCostView('fit', 1)).toEqual(DEFAULT_COST_VIEW);
  });

  it('defaults when the stored value is corrupt', () => {
    store.set('mco.costView', '{not json');
    expect(loadCostView('plan', 3)).toEqual(DEFAULT_COST_VIEW);
  });

  it('round-trips per entity without mixing fits and plans', () => {
    const lsiView = view({ system: 'lsi', thresholds: { sp: 250_000, lsi: 3, timeDays: 14 } });
    saveCostView('fit', 12, lsiView);
    expect(loadCostView('fit', 12)).toEqual(lsiView);
    expect(loadCostView('plan', 12)).toEqual(DEFAULT_COST_VIEW);
    expect(loadCostView('fit', 13)).toEqual(DEFAULT_COST_VIEW);
  });

  it('sanitizes a stored entry with bad fields back to defaults', () => {
    store.set(
      'mco.costView',
      JSON.stringify({ 'fit:1': { system: 'bogus', thresholds: { sp: -5, lsi: 'x' } } }),
    );
    expect(loadCostView('fit', 1)).toEqual(DEFAULT_COST_VIEW);
  });
});

describe('costMetric', () => {
  it('picks the selected system’s gap', () => {
    expect(costMetric('sp', metrics())).toBe(100_000);
    expect(costMetric('lsi', metrics())).toBe(1);
    expect(costMetric('time', metrics())).toBe(300);
  });

  it('is null only for time without data', () => {
    expect(costMetric('time', metrics({ timeGapMinutes: null }))).toBeNull();
    expect(costMetric('sp', metrics({ timeGapMinutes: null }))).toBe(100_000);
  });
});

describe('activeThreshold', () => {
  it('returns the selected system’s threshold, converting days to minutes', () => {
    const v = view({ thresholds: { sp: 250_000, lsi: 2, timeDays: 1.5 } });
    expect(activeThreshold({ ...v, system: 'sp' })).toBe(250_000);
    expect(activeThreshold({ ...v, system: 'lsi' })).toBe(2);
    expect(activeThreshold({ ...v, system: 'time' })).toBe(2160);
  });
});

describe('formatCost', () => {
  it('formats each system in its own unit', () => {
    expect(formatCost('sp', metrics({ spGap: 412_000 }))).toBe('412k SP');
    expect(formatCost('lsi', metrics({ lsiGap: 1 }))).toBe('1 injector');
    expect(formatCost('lsi', metrics({ lsiGap: 2 }))).toBe('2 injectors');
    expect(formatCost('time', metrics({ timeGapMinutes: 20_340 }))).toBe('14d 3h');
  });

  it('shows an em dash for unknown time', () => {
    expect(formatCost('time', metrics({ timeGapMinutes: null }))).toBe('—');
  });
});

describe('formatThresholdLabel', () => {
  it('labels the threshold in the selected system’s unit', () => {
    const thresholds = { sp: 500_000, lsi: 2, timeDays: 7 };
    expect(formatThresholdLabel(view({ system: 'sp', thresholds }))).toBe('500k SP');
    expect(formatThresholdLabel(view({ system: 'lsi', thresholds }))).toBe('2 injectors');
    expect(formatThresholdLabel(view({ system: 'time', thresholds }))).toBe('7d 0h');
  });
});

describe('compareByCost', () => {
  it('orders ascending by the selected metric with SP as tiebreak', () => {
    const small = metrics({ lsiGap: 1, spGap: 50_000 });
    const large = metrics({ lsiGap: 3, spGap: 10_000 });
    expect(compareByCost('lsi', small, large)).toBeLessThan(0);
    const tied = metrics({ lsiGap: 1, spGap: 90_000 });
    expect(compareByCost('lsi', small, tied)).toBeLessThan(0);
  });

  it('sorts unknown time after every known value', () => {
    const known = metrics({ timeGapMinutes: 1_000_000 });
    const unknown = metrics({ timeGapMinutes: null });
    expect(compareByCost('time', known, unknown)).toBeLessThan(0);
    expect(compareByCost('time', unknown, known)).toBeGreaterThan(0);
    // Two unknowns fall back to the SP gap.
    const unknownSmaller = metrics({ timeGapMinutes: null, spGap: 1 });
    expect(compareByCost('time', unknownSmaller, unknown)).toBeLessThan(0);
  });
});
