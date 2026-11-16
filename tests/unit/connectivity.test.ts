import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectivityGate, PAUSE_AFTER_FAILURES, PAUSE_MS } from '@main/esi/connectivity';

describe('ConnectivityGate', () => {
  let now = 1_000_000;
  let gate: ConnectivityGate;
  let online = true;

  beforeEach(() => {
    now = 1_000_000;
    online = true;
    gate = new ConnectivityGate(() => now);
    gate.useOnlineProbe(() => online);
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lets background work through by default', () => {
    expect(gate.blockedReason()).toBeNull();
    expect(gate.shouldSkip('the sweep')).toBe(false);
    expect(gate.pausedUntilIso()).toBeNull();
  });

  it('reports offline while the OS says there is no network', () => {
    online = false;
    expect(gate.blockedReason()).toBe('offline');
    online = true;
    expect(gate.blockedReason()).toBeNull();
  });

  it('pauses after a run of failures with no response between them', () => {
    for (let i = 0; i < PAUSE_AFTER_FAILURES - 1; i += 1) gate.noteNetworkFailure();
    expect(gate.blockedReason()).toBeNull();

    gate.noteNetworkFailure();
    expect(gate.blockedReason()).toBe('paused');
    expect(gate.pausedUntilIso()).toBe(new Date(now + PAUSE_MS).toISOString());

    now += PAUSE_MS - 1;
    expect(gate.blockedReason()).toBe('paused');
    now += 1;
    expect(gate.blockedReason()).toBeNull();
  });

  it('a response of any kind breaks the run and ends a pause', () => {
    for (let i = 0; i < PAUSE_AFTER_FAILURES - 1; i += 1) gate.noteNetworkFailure();
    gate.noteResponse();
    gate.noteNetworkFailure();
    expect(gate.blockedReason()).toBeNull();

    for (let i = 0; i < PAUSE_AFTER_FAILURES; i += 1) gate.noteNetworkFailure();
    expect(gate.blockedReason()).toBe('paused');
    gate.noteResponse();
    expect(gate.blockedReason()).toBeNull();
  });

  it('another full run extends a pause; a partial one does not', () => {
    for (let i = 0; i < PAUSE_AFTER_FAILURES; i += 1) gate.noteNetworkFailure();
    const firstEnd = gate.pausedUntilIso();

    now += 1000;
    gate.noteNetworkFailure();
    expect(gate.pausedUntilIso()).toBe(firstEnd);

    for (let i = 1; i < PAUSE_AFTER_FAILURES; i += 1) gate.noteNetworkFailure();
    expect(gate.pausedUntilIso()).toBe(new Date(now + PAUSE_MS).toISOString());
  });

  it('offline outranks a pause in what it reports', () => {
    for (let i = 0; i < PAUSE_AFTER_FAILURES; i += 1) gate.noteNetworkFailure();
    online = false;
    expect(gate.blockedReason()).toBe('offline');
    expect(gate.pausedUntilIso()).toBeNull();
  });

  it('logs a transition once, not once per tick', () => {
    const log = vi.mocked(console.log);
    online = false;
    expect(gate.shouldSkip('presence')).toBe(true);
    expect(gate.shouldSkip('presence')).toBe(true);
    expect(gate.shouldSkip('the sweep')).toBe(true);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]![0]).toMatch(/offline/);

    online = true;
    expect(gate.shouldSkip('presence')).toBe(false);
    expect(gate.shouldSkip('presence')).toBe(false);
    expect(log).toHaveBeenCalledTimes(2);
    expect(log.mock.calls[1]![0]).toMatch(/back/);
  });

  it('says nothing when it was never blocked', () => {
    gate.shouldSkip('presence');
    gate.shouldSkip('presence');
    expect(console.log).not.toHaveBeenCalled();
  });
});
