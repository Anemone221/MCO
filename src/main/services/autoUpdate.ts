import { autoUpdater, type ProgressInfo, type UpdateInfo } from 'electron-updater';
import { toTag } from '../update/mapUpdateInfo';

/**
 * Installing a new MCO in place, via `electron-updater`.
 *
 * This module owns the updater object and nothing else: it knows how to check,
 * download and install, and it reports where it got to. Composing that with the
 * cached release check, the dismissal and the `UpdateStatus` the renderer reads
 * is `updateService.ts`'s job — which is also why this file imports nothing from
 * it. The dependency runs one way, and the change callback carries the other.
 *
 * Nothing here starts on its own. `autoDownload` is off, so a check only ever
 * *finds* an update; bytes move when the user clicks Download. That matters for
 * a tool holding an open SQLite profile and a background sync sweep — the user
 * picks the moment, not the scheduler.
 *
 * Updates are unsigned for now. The download still comes over HTTPS from GitHub
 * and is verified against the SHA-512 in `latest.yml`; what is missing is the
 * Windows Authenticode check, which electron-updater skips (with a log line) on
 * an unsigned app. macOS is stricter and gets no in-place update at all — see
 * `isUpdaterAvailable` below and `docs/development.md`.
 */

/** How far an install the user asked for has got. */
export type UpdatePhase = 'idle' | 'downloading' | 'ready';

export interface EngineState {
  phase: UpdatePhase;
  /** 0-100. Meaningful while `phase` is `downloading`. */
  percent: number;
  /** Tag of the release being downloaded, or downloaded and waiting to install. */
  version: string | null;
  /** Why the last download or install attempt stopped; cleared when one starts. */
  error: string | null;
}

/** `download-progress` fires far more often than a progress bar needs. */
const PROGRESS_INTERVAL_MS = 250;

let state: EngineState = { phase: 'idle', percent: 0, version: null, error: null };
let initialized = false;
let notify: () => void = () => {};
let lastProgressAt = 0;

/**
 * Whether a check has resolved in *this* process.
 *
 * `downloadUpdate()` reads the update info the last check left behind and
 * rejects when there is none — and MCO's check usually answers from the
 * `app_settings` cache without going near the updater, so a user can click
 * Download on a banner this process never checked for. `startDownload` checks
 * first when this is false.
 */
let checked = false;

function setState(next: EngineState): void {
  state = next;
  notify();
}

function fail(err: unknown): void {
  const reason = err instanceof Error ? err.message : String(err);
  console.warn(`[update] ${reason}`);
  // Back to idle rather than stuck at a percentage: the banner offers Download
  // again, which is the only useful thing left to do.
  setState({ phase: 'idle', percent: 0, version: state.version, error: reason });
}

/**
 * Configure the updater and wire its events. Idempotent — the listeners must be
 * attached once, and a second call would double every push to the renderer.
 *
 * `onStateChange` is called whenever the phase, percentage or error moves, and
 * is how a download reaches the UI without this module knowing what an
 * `UpdateStatus` is.
 */
export function initAutoUpdate(onStateChange: () => void): void {
  if (initialized) return;
  initialized = true;
  notify = onStateChange;

  // The one line the whole "notify, then let the user decide" design rests on.
  autoUpdater.autoDownload = false;
  // Left at its default deliberately. Once someone has clicked Download,
  // applying it the next time MCO quits is the same intent — and without it a
  // tray-resident profile could sit on a downloaded update for weeks.
  autoUpdater.autoInstallOnAppQuit = true;

  // Routed through console so `initLogCapture()` picks it up and Settings →
  // "Export logs" carries the updater's account of a failed update.
  autoUpdater.logger = {
    info: (message?: unknown) => console.log(`[update] ${String(message)}`),
    warn: (message?: unknown) => console.warn(`[update] ${String(message)}`),
    error: (message?: unknown) => console.error(`[update] ${String(message)}`),
    debug: () => {},
  };

  // No `update-available` / `update-not-available` listeners: `checkForUpdates()`
  // resolves with the same information, and one source of it means the phase
  // can't disagree with what the caller was told. `error` is different — an
  // EventEmitter with no error listener throws.
  autoUpdater.on('error', (err: Error) => fail(err));

  autoUpdater.on('download-progress', (progress: ProgressInfo) => {
    const percent = Math.max(0, Math.min(100, Math.round(progress.percent)));
    state = { ...state, phase: 'downloading', percent };
    const now = Date.now();
    if (now - lastProgressAt < PROGRESS_INTERVAL_MS) return;
    lastProgressAt = now;
    notify();
  });

  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    setState({ phase: 'ready', percent: 100, version: toTag(info.version), error: null });
  });
}

/**
 * Whether this build can install in place.
 *
 * `isUpdaterActive()` is the updater's own answer — false when the app is not
 * packaged (no `app-update.yml` beside it to say where releases come from), so
 * a build run from source keeps linking to the release page instead of offering
 * a button that could not work.
 *
 * macOS is excluded on top of that. Squirrel.Mac only applies an update whose
 * code signature matches the running app's, and MCO's mac builds carry an
 * ad-hoc signature rather than a Developer ID one, so the install would fail
 * *after* a ~100 MB download; the DMG-only mac target doesn't publish the ZIP
 * the mac updater reads either. The check itself still runs (over the REST API,
 * see `updateService.fetchLatest`), so a mac user is told a release landed and
 * gets the "View release" link — which is the honest offer there.
 */
export function isUpdaterAvailable(): boolean {
  if (process.platform === 'darwin') return false;
  return initialized && autoUpdater.isUpdaterActive();
}

export function getEngineState(): EngineState {
  return state;
}

/**
 * Ask the update feed what the latest release is. Resolves with it whether or
 * not it is newer than the running build — deciding that stays with
 * `isNewerVersion`, so both check paths answer the same question the same way.
 */
export async function runCheck(): Promise<UpdateInfo | null> {
  const result = await autoUpdater.checkForUpdates();
  checked = result !== null;

  const info = result?.updateInfo ?? null;
  // Recorded without notifying: learning a version is not a phase change, and
  // the caller pushes a fresh status once it has folded this into the cache.
  if (info !== null) state = { ...state, version: toTag(info.version) };
  return info;
}

/**
 * Begin downloading the pending update.
 *
 * Returns as soon as the download has *started* — the renderer gets
 * `downloading` back immediately and follows the rest through progress pushes.
 * Never rejects: a failure lands in `state.error`, where it reaches the UI as a
 * sentence beside the banner rather than an exception at a button.
 */
export async function startDownload(): Promise<void> {
  if (!isUpdaterAvailable()) {
    setState({ ...state, error: 'This build cannot install updates in place.' });
    return;
  }
  // Already moving, or already sitting on a downloaded installer.
  if (state.phase !== 'idle') return;

  try {
    if (!checked) await runCheck();
  } catch (err) {
    fail(err);
    return;
  }

  lastProgressAt = 0;
  setState({ phase: 'downloading', percent: 0, version: state.version, error: null });
  // Not awaited: `update-downloaded` finishes the story, and holding the IPC
  // reply open for a 100 MB download would time out the button that started it.
  void autoUpdater.downloadUpdate().catch((err: unknown) => fail(err));
}

/**
 * Quit and run the downloaded installer, then relaunch.
 *
 * Silent (`/S`) rather than the assisted wizard the first install shows: the
 * NSIS installer reads the previous install directory back out of the registry,
 * so an update lands where the user originally put MCO without asking again.
 */
export function installNow(): void {
  if (state.phase !== 'ready') {
    setState({ ...state, error: 'No update has been downloaded yet.' });
    return;
  }
  // Deferred a tick so the IPC reply flushes first: `quitAndInstall` starts
  // tearing the app down synchronously, and the renderer's `invoke` would
  // otherwise never settle.
  setImmediate(() => autoUpdater.quitAndInstall(true, true));
}
