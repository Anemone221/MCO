import { net, powerMonitor, type BrowserWindow } from 'electron';
import { IpcChannel } from '@shared/ipc';
import { connectivity } from '../esi/connectivity';
import { syncDueCharacters } from './characterSync';
import { syncBlueprintCorps } from './blueprintService';
import { pruneDismissedNotifications } from '../db/repositories/notifications';
import { runAutoBackupIfDue } from './backupService';
import { runPresenceNow, startLiveTracking, stopLiveTracking } from './liveTracking';
import {
  checkCloneJumpReady,
  checkFatigueCleared,
  checkIdleOmegaAccounts,
  checkQueueDrainWarnings,
} from './notificationService';

/** Hourly background sync; each sweep only touches characters whose cache has expired. */
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;
/** Delay before the first sweep so it does not compete with app startup. */
const STARTUP_DELAY_MS = 15_000;
/** How long a dismissed notification is kept; see `pruneDismissedNotifications`. */
const NOTIFICATION_RETENTION_DAYS = 30;
/**
 * Wait after the system wakes before the catch-up sweep: Wi-Fi reassociates
 * and VPNs reconnect in the first seconds, and a sweep started into that only
 * fails and pauses itself.
 */
const RESUME_DELAY_MS = 10_000;
/** While the network is still down after a wake, how often to look again, and for how long. */
const CATCH_UP_RETRY_MS = 60_000;
const CATCH_UP_RETRY_LIMIT = 30;

let intervalTimer: NodeJS.Timeout | null = null;
let startupTimer: NodeJS.Timeout | null = null;
let catchUpTimer: NodeJS.Timeout | null = null;
let currentGetWindow: (() => BrowserWindow | null) | null = null;

/** When the last sweep finished, and when the interval timer was armed (for ETA math). */
let lastSweepAt: string | null = null;
let intervalArmedAtMs: number | null = null;

export interface SchedulerStatus {
  running: boolean;
  lastSweepAt: string | null;
  /** Estimated next interval tick; the startup sweep or a wake-up catch-up may fire sooner. */
  nextSweepAt: string | null;
  /** Why background work is waiting, or null when it is not. */
  network: 'offline' | 'paused' | null;
  /** When a network pause ends; null unless `network` is `paused`. */
  networkPausedUntil: string | null;
}

export function getSchedulerStatus(): SchedulerStatus {
  let nextSweepAt: string | null = null;
  if (intervalArmedAtMs !== null) {
    const elapsed = Date.now() - intervalArmedAtMs;
    const ticks = Math.floor(elapsed / SWEEP_INTERVAL_MS) + 1;
    nextSweepAt = new Date(intervalArmedAtMs + ticks * SWEEP_INTERVAL_MS).toISOString();
  }
  return {
    running: intervalTimer !== null,
    lastSweepAt,
    nextSweepAt,
    network: connectivity.blockedReason(),
    networkPausedUntil: connectivity.pausedUntilIso(),
  };
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

/** True while a sweep is running (the tray's "Run sync now" would join it). */
export function isSweepInFlight(): boolean {
  return sweepInFlight !== null;
}

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
  // Housekeeping that only needs to happen now and then rides the sweep: it is
  // the one thing guaranteed to recur for as long as MCO runs, tray-only
  // sessions included. Neither step throws, and neither needs the network.
  await runAutoBackupIfDue();
  try {
    const pruned = pruneDismissedNotifications(NOTIFICATION_RETENTION_DAYS);
    if (pruned > 0) console.log(`[scheduler] removed ${pruned} old dismissed notification(s)`);
  } catch (err) {
    console.error('[scheduler] notification cleanup failed:', err);
  }

  // No network: nothing below could succeed, and every due character would
  // spend its retry budget to read "sync failed". The characters stay due, so
  // the next tick — or the catch-up after a wake — picks them up. The timer
  // checks that follow read stored data and still run.
  const skipped = connectivity.shouldSkip('the hourly sweep');
  if (!skipped) {
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
  }

  try {
    checkQueueDrainWarnings(getWindow);
  } catch (err) {
    console.error('[scheduler] queue-drain check failed:', err);
  }

  try {
    checkIdleOmegaAccounts(getWindow);
  } catch (err) {
    console.error('[scheduler] idle-Omega account check failed:', err);
  }

  // Both of these read timers the sync above has just refreshed, so they run
  // after it rather than on a cadence of their own.
  try {
    checkFatigueCleared(getWindow);
  } catch (err) {
    console.error('[scheduler] jump-fatigue check failed:', err);
  }

  try {
    checkCloneJumpReady(getWindow);
  } catch (err) {
    console.error('[scheduler] clone-jump check failed:', err);
  }
}

/** (Re)start the hourly cadence from now. The ETA in Settings is computed from this moment. */
function armInterval(getWindow: () => BrowserWindow | null): void {
  if (intervalTimer) clearInterval(intervalTimer);
  intervalTimer = setInterval(() => void runSweep(getWindow), SWEEP_INTERVAL_MS);
  intervalArmedAtMs = Date.now();
}

function clearCatchUp(): void {
  if (catchUpTimer) clearTimeout(catchUpTimer);
  catchUpTimer = null;
}

/**
 * Sweep as soon as the network allows, looking again every minute for up to
 * half an hour. The catch-up after a wake lands while Wi-Fi is still coming
 * back more often than not; without the retry it would be skipped and the
 * next real sweep would be up to an hour away.
 */
function scheduleCatchUp(getWindow: () => BrowserWindow | null, delayMs: number, attempt = 1): void {
  clearCatchUp();
  catchUpTimer = setTimeout(() => {
    catchUpTimer = null;
    if (connectivity.blockedReason() !== null) {
      if (attempt < CATCH_UP_RETRY_LIMIT) scheduleCatchUp(getWindow, CATCH_UP_RETRY_MS, attempt + 1);
      else console.log('[scheduler] still no network half an hour after waking; waiting for the hourly tick');
      return;
    }
    // Presence first: a character that logged off during the sleep should
    // drop out of the active loop before it is polled again.
    void runPresenceNow();
    void runSweep(getWindow);
  }, delayMs);
}

/**
 * The system woke from sleep. `setInterval` does not catch up on the time
 * slept, and whatever it does next is out of step with the ETA, so the cadence
 * restarts from now and a sweep runs as soon as the network is back — the
 * point of running in the tray is that the roster is fresh when the lid opens.
 */
function onResume(): void {
  if (!currentGetWindow) return;
  console.log('[scheduler] system resumed; cadence restarted, catch-up sweep pending');
  armInterval(currentGetWindow);
  scheduleCatchUp(currentGetWindow, RESUME_DELAY_MS);
}

/** Start the hourly background sync. Safe to call once; further calls are ignored. */
export function startScheduler(getWindow: () => BrowserWindow | null): void {
  if (intervalTimer) return;
  currentGetWindow = getWindow;
  connectivity.useOnlineProbe(() => net.isOnline());
  startupTimer = setTimeout(() => void runSweep(getWindow), STARTUP_DELAY_MS);
  armInterval(getWindow);
  powerMonitor.on('resume', onResume);
  // The fast lane for online characters rides the scheduler's lifetime.
  startLiveTracking(getWindow);
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
  clearCatchUp();
  powerMonitor.off('resume', onResume);
  intervalArmedAtMs = null;
  currentGetWindow = null;
  stopLiveTracking();
}

/** Run one sync sweep immediately (tray "Run sync now"). No-op if the scheduler is not running. */
export async function runSweepNow(): Promise<void> {
  if (currentGetWindow) await runSweep(currentGetWindow);
}
