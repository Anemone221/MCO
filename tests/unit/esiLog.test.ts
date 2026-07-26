import { beforeEach, describe, expect, it } from 'vitest';
import {
  formatEsiDiagnostics,
  getEsiActivity,
  recordCacheFresh,
  recordEvent,
  recordSlow,
  recordStatus,
  resetEsiLog,
} from '@main/esi/esiLog';

beforeEach(() => resetEsiLog());

describe('recordStatus', () => {
  it('tallies each network response into the right bucket and bumps requests', () => {
    recordStatus(200);
    recordStatus(200);
    recordStatus(304);
    recordStatus(401);
    recordStatus(420);
    recordStatus(429);
    recordStatus(503);
    recordStatus(404);

    const a = getEsiActivity();
    expect(a.requests).toBe(8);
    expect(a.status).toMatchObject({
      ok200: 2,
      notModified304: 1,
      unauthorized401: 1,
      throttled420: 1,
      throttled429: 1,
      serverError5xx: 1,
      otherError: 1,
    });
  });

  it('cache-fresh hits are counted separately from network requests', () => {
    recordCacheFresh();
    recordCacheFresh();
    recordStatus(200);
    const a = getEsiActivity();
    expect(a.cacheFresh).toBe(2);
    expect(a.requests).toBe(1);
  });
});

describe('recordEvent', () => {
  it('updates the counters each event kind implies', () => {
    recordEvent({ kind: 'timeout', path: '/x' });
    recordEvent({ kind: 'network-error', path: '/x' });
    recordEvent({ kind: 'give-up', path: '/x' });
    recordEvent({ kind: 'backoff', backoffSeconds: 30 });
    recordEvent({ kind: 'backoff', backoffSeconds: 60 });

    const a = getEsiActivity();
    expect(a.timeouts).toBe(1);
    expect(a.networkErrors).toBe(1);
    expect(a.giveUps).toBe(1);
    expect(a.backoffWindows).toBe(2);
    expect(a.totalBackoffSeconds).toBe(90);
    expect(a.maxBackoffSeconds).toBe(60);
  });

  it('keeps the events in the ring buffer, newest last, and truncates recent for the UI', () => {
    for (let i = 0; i < 60; i += 1) recordEvent({ kind: 'throttle', path: `/p${i}`, status: 429 });
    const a = getEsiActivity(10);
    expect(a.recentEvents).toHaveLength(10);
    expect(a.recentEvents.at(-1)?.path).toBe('/p59');
    expect(a.recentEvents[0]?.path).toBe('/p50');
  });
});

describe('recordSlow', () => {
  it('records only requests at or over the slow threshold', () => {
    recordSlow({ path: '/fast', ms: 500 });
    recordSlow({ path: '/slow', ms: 12_000 });
    const a = getEsiActivity();
    expect(a.slowRequests).toBe(1);
    expect(a.recentEvents.some((e) => e.kind === 'slow' && e.path === '/slow')).toBe(true);
  });
});

describe('formatEsiDiagnostics', () => {
  it('renders the counters and event lines for export', () => {
    recordStatus(200);
    recordEvent({ kind: 'throttle', path: '/characters/1/clones', status: 429, backoffSeconds: 60 });
    const text = formatEsiDiagnostics();
    expect(text).toContain('Requests:');
    expect(text).toContain('429=');
    expect(text).toContain('[throttle]');
    expect(text).toContain('/characters/1/clones');
  });

  it('says so when nothing noteworthy happened', () => {
    recordStatus(200);
    expect(formatEsiDiagnostics()).toContain('no throttles');
  });
});
