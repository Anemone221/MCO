import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  loadPodSectionCollapsed,
  medicalCloneMismatch,
  savePodSectionCollapsed,
  summarizeQueue,
} from '@renderer/lib/groupView';

const NOW = Date.parse('2026-07-15T12:00:00Z');

describe('summarizeQueue', () => {
  it('reports an empty queue', () => {
    expect(summarizeQueue(0, null, NOW)).toEqual({ state: 'empty' });
  });

  it('ignores a stray end date when the queue has no entries', () => {
    expect(summarizeQueue(0, '2026-08-01T00:00:00Z', NOW)).toEqual({ state: 'empty' });
  });

  it('reports a paused queue when entries exist but no end date is set', () => {
    expect(summarizeQueue(4, null, NOW)).toEqual({ state: 'paused', queued: 4 });
  });

  it('reports an active queue with its end date', () => {
    expect(summarizeQueue(3, '2026-07-20T12:00:00Z', NOW)).toEqual({
      state: 'active',
      queued: 3,
      endDate: '2026-07-20T12:00:00Z',
    });
  });

  it('reports a finished queue once the end date has passed', () => {
    expect(summarizeQueue(2, '2026-07-14T12:00:00Z', NOW)).toEqual({
      state: 'finished',
      queued: 2,
    });
  });

  it('treats an end date exactly at now as finished', () => {
    expect(summarizeQueue(1, '2026-07-15T12:00:00Z', NOW)).toEqual({
      state: 'finished',
      queued: 1,
    });
  });

  it('treats an unparseable end date as finished rather than crashing', () => {
    expect(summarizeQueue(1, 'not-a-date', NOW)).toEqual({ state: 'finished', queued: 1 });
  });
});

describe('medicalCloneMismatch', () => {
  const HOME = 1035466617946;

  it('flags a medical clone parked somewhere other than the home station', () => {
    expect(medicalCloneMismatch(HOME, { locationId: 60003760 })).toBe(true);
  });

  it('does not flag a medical clone at the home station', () => {
    expect(medicalCloneMismatch(HOME, { locationId: HOME })).toBe(false);
  });

  it('never flags when the group has no home station', () => {
    expect(medicalCloneMismatch(null, { locationId: 60003760 })).toBe(false);
  });

  it('never flags when clone data has not synced — missing data is not an alarm', () => {
    expect(medicalCloneMismatch(HOME, null)).toBe(false);
  });
});

describe('pod-section collapse persistence', () => {
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

  it('defaults to expanded when nothing is stored', () => {
    expect(loadPodSectionCollapsed(1)).toBe(false);
  });

  it('defaults to expanded when localStorage is unavailable', () => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
    expect(loadPodSectionCollapsed(1)).toBe(false);
  });

  it('defaults to expanded when the stored value is corrupt', () => {
    store.set('mco.podLocations.collapsed', '{not json');
    expect(loadPodSectionCollapsed(1)).toBe(false);
  });

  it('round-trips a collapsed group without affecting others', () => {
    savePodSectionCollapsed(1, true);
    expect(loadPodSectionCollapsed(1)).toBe(true);
    expect(loadPodSectionCollapsed(2)).toBe(false);
  });

  it('expanding a group removes its entry', () => {
    savePodSectionCollapsed(1, true);
    savePodSectionCollapsed(2, true);
    savePodSectionCollapsed(1, false);
    expect(loadPodSectionCollapsed(1)).toBe(false);
    expect(loadPodSectionCollapsed(2)).toBe(true);
  });
});
