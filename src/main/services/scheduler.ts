import type { BrowserWindow } from 'electron';
import { IpcChannel } from '@shared/ipc';
import { syncDueCharacters } from './characterSync';

/** Hourly background sync; each sweep only touches characters whose cache has expired. */
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;
/** Delay before the first sweep so it does not compete with app startup. */
const STARTUP_DELAY_MS = 15_000;

let intervalTimer: NodeJS.Timeout | null = null;
let startupTimer: NodeJS.Timeout | null = null;

async function runSweep(getWindow: () => BrowserWindow | null): Promise<void> {
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
}

/** Start the hourly background sync. Safe to call once; further calls are ignored. */
export function startScheduler(getWindow: () => BrowserWindow | null): void {
  if (intervalTimer) return;
  startupTimer = setTimeout(() => void runSweep(getWindow), STARTUP_DELAY_MS);
  intervalTimer = setInterval(() => void runSweep(getWindow), SWEEP_INTERVAL_MS);
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
}
