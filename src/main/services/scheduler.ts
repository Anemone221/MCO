import type { BrowserWindow } from 'electron';
import { IpcChannel } from '@shared/ipc';
import { syncDueCharacters } from './characterSync';
import { syncBlueprintCorps } from './blueprintService';
import { checkQueueDrainWarnings } from './notificationService';

/** Hourly background sync; each sweep only touches characters whose cache has expired. */
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;
/** Delay before the first sweep so it does not compete with app startup. */
const STARTUP_DELAY_MS = 15_000;

let intervalTimer: NodeJS.Timeout | null = null;
let startupTimer: NodeJS.Timeout | null = null;
let currentGetWindow: (() => BrowserWindow | null) | null = null;

/** When the last sweep finished, and when the interval timer was armed (for ETA math). */
let lastSweepAt: string | null = null;
let intervalArmedAtMs: number | null = null;

export interface SchedulerStatus {
  running: boolean;
  lastSweepAt: string | null;
  /** Estimated next interval tick; the startup sweep may fire sooner. */
  nextSweepAt: string | null;
}

export function getSchedulerStatus(): SchedulerStatus {
  let nextSweepAt: string | null = null;
  if (intervalArmedAtMs !== null) {
    const elapsed = Date.now() - intervalArmedAtMs;
    const ticks = Math.floor(elapsed / SWEEP_INTERVAL_MS) + 1;
    nextSweepAt = new Date(intervalArmedAtMs + ticks * SWEEP_INTERVAL_MS).toISOString();
  }
  return { running: intervalTimer !== null, lastSweepAt, nextSweepAt };
}

/**
 * The sweep currently running, if any. A sweep is not guaranteed to finish
 * inside its interval — one request can wait out several minutes of 420/429
 * backoff, and a full fleet is hundreds of them — so the next tick (or the
 * tray's "Run sync now") can land on top of a sweep still in flight. Two
 * sweeps over the same due characters would double every fetch, race the
 * per-character refresh, and interleave their `replaceSkills` writes. Callers
 * join the running sweep instead of starting a second one.
 */
let sweepInFlight: Promise<void> | null = null;

function runSweep(getWindow: () => BrowserWindow | null): Promise<void> {
  if (sweepInFlight) {
    console.log('[scheduler] a sweep is already running; joining it instead of starting another');
    return sweepInFlight;
  }
  sweepInFlight = executeSweep(getWindow).finally(() => {
    sweepInFlight = null;
  });
  return sweepInFlight;
}

async function executeSweep(getWindow: () => BrowserWindow | null): Promise<void> {
  lastSweepAt = new Date().toISOString();
  try {
    const results = await syncDueCharacters();
    if (results.length > 0) {
      const failed = results.filter((r) => !r.ok).length;
      console.log(
        `[scheduler] synced ${results.length - failed}/${results.length} due character(s)`,
      );
      getWindow()?.webContents.send(IpcChannel.charactersChanged);
    }
  } catch (err) {
    console.error('[scheduler] sync sweep failed:', err);
  }

  // Tracked alt corps: one request per corp per ESI cache window (the client
  // skips the call entirely while the cached entry is fresh), so this rides
  // along with the sweep rather than needing a cadence of its own.
  try {
    await syncBlueprintCorps();
  } catch (err) {
    console.error('[scheduler] corp blueprint sync failed:', err);
  }

  try {
    checkQueueDrainWarnings(getWindow);
  } catch (err) {
    console.error('[scheduler] queue-drain check failed:', err);
  }
}

/** Start the hourly background sync. Safe to call once; further calls are ignored. */
export function startScheduler(getWindow: () => BrowserWindow | null): void {
  if (intervalTimer) return;
  currentGetWindow = getWindow;
  startupTimer = setTimeout(() => void runSweep(getWindow), STARTUP_DELAY_MS);
  intervalTimer = setInterval(() => void runSweep(getWindow), SWEEP_INTERVAL_MS);
  intervalArmedAtMs = Date.now();
}

export function stopScheduler(): void {
  if (startupTimer) {
    clearTimeout(startupTimer);
    startupTimer = null;
  }
  if (intervalTimer) {
    clearInterval(intervalTimer);
    intervalTimer = null;
  }
  intervalArmedAtMs = null;
  currentGetWindow = null;
}

/** Run one sync sweep immediately (tray "Run sync now"). No-op if the scheduler is not running. */
export async function runSweepNow(): Promise<void> {
  if (currentGetWindow) await runSweep(currentGetWindow);
}
