import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectivity } from '@main/esi/connectivity';
import {
  getSchedulerStatus,
  isSweepInFlight,
  startScheduler,
  stopScheduler,
} from '@main/services/scheduler';
import { powerMonitor, setOnline } from './support/electron';
import { answerCharacter, seedCharacter, useFakeEve } from './support/fakeEve';
import { useFreshProfile } from './support/profile';

const ALICE = 90000001;
const HOUR = 60 * 60 * 1000;
/** The scheduler's own delays, as documented in `services/scheduler.ts`. */
const STARTUP_DELAY_MS = 15_000;
const RESUME_DELAY_MS = 10_000;
const CATCH_UP_RETRY_MS = 60_000;

const skillsPath = `/characters/${ALICE}/skills`;

/** Captured before any test fakes the clock: how to let the real event loop turn. */
const realSetTimeout = setTimeout;
const yieldToLoop = (): Promise<void> => new Promise((resolve) => realSetTimeout(resolve, 0));

/**
 * Let up to `ms` of fake time pass, in small steps with a turn of the real
 * event loop between them (the weekly backup and the fake network finish
 * there), until `expectation` holds. Throws its last failure if it never does.
 */
async function settle(ms: number, expectation: () => void): Promise<void> {
  const deadline = Date.now() + ms;
  for (;;) {
    try {
      expectation();
      return;
    } catch (err) {
      if (Date.now() >= deadline) throw err;
    }
    await vi.advanceTimersByTimeAsync(Math.min(250, deadline - Date.now()));
    await yieldToLoop();
  }
}

/** Fake time with nothing expected of it. */
async function pass(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
  await yieldToLoop();
}

describe('scheduler', () => {
  useFreshProfile();
  const eve = useFakeEve();

  beforeEach(() => {
    // Only the clocks the scheduler and the ESI client's retry sleeps use;
    // the backup's fs work and setImmediate steps stay on the real loop.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    // Quiet by default; MCO_TEST_LOG=1 shows the scheduler's own lines when a test misbehaves.
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      if (process.env['MCO_TEST_LOG']) process.stderr.write(`${args.map(String).join(' ')}\n`);
    });
    connectivity.reset();
    setOnline(true);
    // A day-long access token: some tests sleep the machine for a while.
    seedCharacter({ characterId: ALICE, name: 'Alice', expiresIn: 24 * 3600 });
    answerCharacter(eve, ALICE, 'Alice');
  });

  afterEach(async () => {
    // A sweep this test started must not run on into the next test's profile.
    await settle(10 * 60 * 1000, () => expect(isSweepInFlight()).toBe(false));
    stopScheduler();
    setOnline(true);
    connectivity.reset();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('runs the first sweep after the startup delay', async () => {
    startScheduler(() => null);
    expect(getSchedulerStatus()).toMatchObject({ running: true, network: null });

    await settle(STARTUP_DELAY_MS + 1000, () => expect(eve.count(skillsPath)).toBe(1));
    expect(getSchedulerStatus().lastSweepAt).not.toBeNull();
  });

  it('skips the sweep while the OS says there is no network, and says so in its status', async () => {
    setOnline(false);
    const before = getSchedulerStatus().lastSweepAt;
    startScheduler(() => null);

    await pass(STARTUP_DELAY_MS + 1);
    await pass(HOUR);
    expect(eve.esiRequests).toEqual([]);
    expect(getSchedulerStatus()).toMatchObject({ lastSweepAt: before, network: 'offline' });
  });

  it('after a wake, sweeps as soon as the network is back and restarts the hourly cadence', async () => {
    setOnline(false);
    startScheduler(() => null);
    await pass(STARTUP_DELAY_MS + 1);
    const armedAt = Date.now();

    // Twenty minutes in, the machine sleeps and wakes. Wi-Fi is still down.
    await pass(20 * 60 * 1000);
    const wakeAt = Date.now();
    powerMonitor.emit('resume');
    await pass(RESUME_DELAY_MS + 1);
    expect(eve.esiRequests).toEqual([]);

    // The cadence restarted at the wake, not at the original arming.
    const next = new Date(getSchedulerStatus().nextSweepAt!).getTime();
    expect(next).toBeGreaterThan(armedAt + HOUR);
    expect(Math.abs(next - (wakeAt + HOUR))).toBeLessThan(1000);

    // The network comes back; the next look a minute later sweeps.
    setOnline(true);
    await settle(CATCH_UP_RETRY_MS + 1000, () => expect(eve.count(skillsPath)).toBe(1));
    expect(getSchedulerStatus().network).toBeNull();
  });

  it('pauses background work after a run of requests that got no response', async () => {
    eve.offline(true);
    startScheduler(() => null);

    // The first sweep runs into the dead network: the critical requests are
    // retried, then the sweep gives up on the character.
    await settle(STARTUP_DELAY_MS + 10_000, () => expect(eve.count(skillsPath)).toBe(4));
    expect(getSchedulerStatus().network).toBe('paused');
    expect(getSchedulerStatus().networkPausedUntil).not.toBeNull();
  });
});
