import { Notification, type Tray } from 'electron';
import type { BackgroundModeSettings } from '@shared/types';
import { getFlag, setFlag } from '../db/repositories/appSettings';
import { createBackgroundTray } from '../tray';

/**
 * Tray residency: keeping the process (and therefore the hourly sync sweep)
 * alive with the window closed.
 *
 * The scheduler already runs in both launch modes — `--background` only decides
 * whether a window and a tray icon exist. This module makes that a runtime
 * choice instead of a launch-time one, so the user can drop a normally-launched
 * MCO into tray-only sync from the Settings page without restarting.
 *
 * Deliberately imports no other service: `notificationService` calls
 * `openWindow` from here, so a dependency the other way would be a cycle.
 */

const CLOSE_TO_TRAY_KEY = 'close_to_tray';
const TRAY_NOTICE_KEY = 'tray_notice_shown';

interface BackgroundHooks {
  /** Show the main window, creating it if it was closed. */
  openWindow: () => void;
  /** Close the main window; the tray keeps the process alive. */
  closeWindow: () => void;
  /** Tray "Run sync now". */
  runSyncNow: () => void;
  /** This process was launched with `--background` (tray-only from the start). */
  launchedInBackground: boolean;
}

let hooks: BackgroundHooks | null = null;
let tray: Tray | null = null;
/**
 * Set by "Run in background now" so the window close that follows does not quit
 * the app even when the persisted preference is off. Sticky for the session —
 * the tray icon is up, and quitting from it is one click.
 */
let residentThisSession = false;

/** Wire up the window callbacks and raise the tray if this profile wants one. */
export function initBackgroundMode(opts: BackgroundHooks): BackgroundModeSettings {
  hooks = opts;
  if (opts.launchedInBackground || getFlag(CLOSE_TO_TRAY_KEY)) ensureTray();
  return getBackgroundModeSettings();
}

/** Whether the app should outlive its window (see `shouldQuitOnWindowClose`). */
export function isResidentInTray(): boolean {
  if (hooks?.launchedInBackground === true) return true;
  // Runtime residency requires a tray icon that actually came up. Without one
  // there is no way back to the window and no way to quit, so a closed window
  // would leave an invisible process the user can only kill from the task
  // manager — worse than simply quitting.
  if (tray === null) return false;
  return residentThisSession || getFlag(CLOSE_TO_TRAY_KEY);
}

/** Show the main window from outside the window lifecycle (tray, toast click). */
export function openWindow(): void {
  hooks?.openWindow();
}

export function getBackgroundModeSettings(): BackgroundModeSettings {
  return {
    closeToTray: getFlag(CLOSE_TO_TRAY_KEY),
    launchedInBackground: hooks?.launchedInBackground ?? false,
    trayActive: tray !== null,
  };
}

/**
 * Persist the close-to-tray preference. The tray icon follows immediately —
 * turning it on is the feedback that it worked, and makes "Run sync now"
 * reachable without closing the window first.
 */
export function setCloseToTray(enabled: boolean): BackgroundModeSettings {
  setFlag(CLOSE_TO_TRAY_KEY, enabled);
  if (enabled) ensureTray();
  else if (!isResidentInTray()) destroyTray();
  return getBackgroundModeSettings();
}

/**
 * Drop to tray-only sync now: raise the tray, then close the window. Keeps the
 * window open if the tray could not be created — closing it would strand the
 * process with no way back.
 */
export function enterBackgroundNow(): BackgroundModeSettings {
  if (!ensureTray()) return getBackgroundModeSettings();
  residentThisSession = true;
  hooks?.closeWindow();
  return getBackgroundModeSettings();
}

/**
 * Tell the user once, ever, that a closed window is not a closed app — a
 * process that vanishes from the taskbar but keeps running reads as a bug.
 */
export function noteWindowClosedIntoTray(): void {
  if (getFlag(TRAY_NOTICE_KEY)) return;
  setFlag(TRAY_NOTICE_KEY, true);
  if (!Notification.isSupported()) return;

  const toast = new Notification({
    title: 'MCO is still running',
    body: 'Character sync continues in the notification area. Use the tray icon to reopen MCO or quit it.',
  });
  toast.on('click', () => openWindow());
  toast.show();
}

/** Raise the tray icon if it isn't up. Returns whether one is up now. */
export function ensureTray(): boolean {
  if (tray) return true;
  if (!hooks) return false;
  const { openWindow: onOpen, runSyncNow: onRunSync } = hooks;
  try {
    tray = createBackgroundTray({ onOpen, onRunSync });
  } catch (err) {
    // Some Linux desktops have no system tray at all; never take the app down
    // over a missing notification area.
    console.error('[background] tray icon unavailable, staying window-only:', err);
    return false;
  }
  return true;
}

export function destroyTray(): void {
  tray?.destroy();
  tray = null;
}
