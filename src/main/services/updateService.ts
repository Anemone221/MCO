import { app, type BrowserWindow } from 'electron';
import { IpcChannel } from '@shared/ipc';
import type { UpdateState, UpdateStatus } from '@shared/types';
import { createSingleFlight } from '../auth/singleFlight';
import { APP_VERSION, GITHUB_RELEASES_URL, GITHUB_URL, USER_AGENT } from '../config';
import { getSetting, setSetting } from '../db/repositories/appSettings';
import { latestReleaseApiUrl, parseRelease, type ReleaseInfo } from '../update/github';
import { releaseFromUpdateInfo } from '../update/mapUpdateInfo';
import { isNewerVersion } from '../update/version';
import {
  getEngineState,
  initAutoUpdate,
  installNow,
  isUpdaterAvailable,
  runCheck,
  startDownload,
} from './autoUpdate';

/**
 * Everything the renderer knows about updates: whether a newer MCO exists, and
 * how far installing it has got.
 *
 * This module owns the answer — the `app_settings` cache, the daily interval,
 * the dismissal, and the `UpdateStatus` shape. It does not own the mechanism:
 * `autoUpdate.ts` does the checking, downloading and installing in a packaged
 * build, and the GitHub REST call below answers everywhere else (a build run
 * from source is updated with `git pull`, not by reinstalling, but it should
 * still be able to say a release happened).
 *
 * The REST check is unauthenticated, and GitHub allows 60 API requests an hour
 * per IP shared across every unauthenticated caller on it — so the answer is
 * cached in `app_settings` and refreshed at most daily either way. Settings →
 * "Check now" bypasses the interval for a user who wants an answer immediately.
 *
 * Nothing downloads on its own: a check only raises the banner, and bytes move
 * when the user clicks it.
 */
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10_000;

const KEY_LAST_CHECK = 'update.lastCheck';
const KEY_DISMISSED = 'update.dismissedVersion';

/** The last *successful* check. A failure never overwrites one. */
interface CachedCheck {
  checkedAt: string;
  /** Null when the check succeeded but the repository has no release yet. */
  latestVersion: string | null;
  releaseName: string | null;
  releaseUrl: string | null;
  publishedAt: string | null;
}

// One key: two windows of the same profile can't both be checking, and the
// Settings page and the banner mounting together make one request, not two.
const inFlight = createSingleFlight<'update', UpdateStatus>();

function readCache(): CachedCheck | null {
  const raw = getSetting(KEY_LAST_CHECK);
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as CachedCheck;
    // A truncated or hand-edited value reads as "never checked" rather than
    // throwing on a page load.
    return typeof parsed?.checkedAt === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Compose the renderer's view from the cached check, how far a download the
 * user started has got, and — when the check that just ran failed — why.
 *
 * `failure` is deliberately not persisted: it describes this attempt, while the
 * cache holds the last thing actually learned. A download in flight outranks
 * both, because `downloading` and `ready` are things the user asked for and is
 * waiting on.
 */
function toStatus(cache: CachedCheck | null, failure: string | null): UpdateStatus {
  const engine = getEngineState();
  const latestVersion = engine.version ?? cache?.latestVersion ?? null;
  const available = latestVersion !== null && isNewerVersion(latestVersion, APP_VERSION);

  const state: UpdateState =
    engine.phase === 'ready'
      ? 'ready'
      : engine.phase === 'downloading'
        ? 'downloading'
        : latestVersion === null
          ? 'unknown'
          : available
            ? 'update-available'
            : 'current';

  return {
    state,
    currentVersion: APP_VERSION,
    latestVersion,
    releaseName: cache?.releaseName ?? null,
    releaseUrl: cache?.releaseUrl ?? GITHUB_RELEASES_URL,
    publishedAt: cache?.publishedAt ?? null,
    checkedAt: cache?.checkedAt ?? null,
    message:
      failure ??
      engine.error ??
      (cache !== null && latestVersion === null ? 'No releases have been published yet.' : null),
    dismissed: latestVersion !== null && getSetting(KEY_DISMISSED) === latestVersion,
    downloadPercent: engine.phase === 'downloading' ? engine.percent : null,
    canInstall: isUpdaterAvailable(),
  };
}

let getWindow: () => BrowserWindow | null = () => null;

/**
 * Push the current status to the renderer. Wired as the updater's change
 * callback, so a download's progress reaches the banner without it polling.
 *
 * The whole status crosses rather than a bare percentage: the banner then has
 * one shape to render and can hand it straight to `useMcoData`'s `setData`.
 */
function pushStatus(): void {
  getWindow()?.webContents.send(IpcChannel.updateProgress, toStatus(readCache(), null));
}

/**
 * Wire the updater at startup. Configures and subscribes only — it does not
 * check. Detection stays where it was: the banner mounting, and Settings →
 * "Check for updates".
 */
export function initUpdates(window: () => BrowserWindow | null): void {
  getWindow = window;
  initAutoUpdate(pushStatus);
}

/**
 * Whether MCO checks on its own.
 *
 * A build running from source is updated with `git pull`, not by reinstalling,
 * so the automatic check is packaged-only — which also keeps `npm run dev` and
 * the test suites off the network and out of GitHub's shared unauthenticated
 * rate limit. `MCO_UPDATE_CHECK=1` opts a development build in, `=0` opts a
 * packaged one out (what the packaged smoke test sets).
 *
 * "Check for updates" in Settings is an explicit request and runs regardless.
 */
function autoCheckEnabled(): boolean {
  const override = process.env['MCO_UPDATE_CHECK'];
  return override === undefined ? app.isPackaged : override === '1';
}

/**
 * The latest release, asked of whichever source this build can act on.
 *
 * A packaged build asks the updater, so the release it learns about is by
 * definition one it can install — the same `latest.yml` the download will come
 * from. Anything else falls back to the REST API. Both return the same shape,
 * so only the fetch differs and the cache never records which ran.
 *
 * Null means the check succeeded and there is no release to report.
 */
async function fetchLatest(): Promise<ReleaseInfo | null> {
  if (!isUpdaterAvailable()) return fetchLatestRelease();

  try {
    const info = await runCheck();
    return info === null ? null : releaseFromUpdateInfo(info, GITHUB_URL);
  } catch (err) {
    // A repository with nothing published is an answer, not a failure — the
    // same one the REST path reads off a 404. The updater raises it instead,
    // so translate rather than let it read as a broken check.
    if ((err as { code?: string })?.code === 'ERR_UPDATER_NO_PUBLISHED_VERSIONS') return null;
    throw err;
  }
}

/** Null means the check succeeded and the repository has no published release. */
async function fetchLatestRelease(): Promise<ReleaseInfo | null> {
  const apiUrl = latestReleaseApiUrl(GITHUB_URL);
  if (apiUrl === null) throw new Error(`Not a GitHub repository URL: ${GITHUB_URL}`);

  const response = await fetch(apiUrl, {
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      // GitHub rejects unauthenticated API requests that don't send one.
      'User-Agent': USER_AGENT,
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  // A repository with no published release answers 404. That is an answer
  // ("nothing to update to"), not a failure — cache it like any other.
  if (response.status === 404) return null;
  if (response.status === 403 || response.status === 429) {
    throw new Error('GitHub rate limit reached — try again later.');
  }
  if (!response.ok) throw new Error(`GitHub responded ${response.status}.`);

  const release = parseRelease(await response.json());
  if (release === null) throw new Error('GitHub returned an unreadable release.');
  return release;
}

/**
 * The current answer, refreshing it first when the cached one has aged out.
 * `force` skips the interval (the "Check now" button).
 *
 * Never rejects: a failed check leaves the last known answer on screen with a
 * message saying why it didn't move. Nothing here is worth interrupting a page
 * load over.
 */
export async function checkForUpdate(force = false): Promise<UpdateStatus> {
  if (!force && !autoCheckEnabled()) {
    return toStatus(readCache(), 'Automatic update checks are off in this build.');
  }

  const cache = readCache();
  const age = cache === null ? Number.NaN : Date.now() - Date.parse(cache.checkedAt);
  // NaN (never checked, or an unparseable timestamp) fails this and refetches.
  if (!force && age < CHECK_INTERVAL_MS) return toStatus(cache, null);

  return inFlight.run('update', async () => {
    try {
      const release = await fetchLatest();
      const fresh: CachedCheck = {
        checkedAt: new Date().toISOString(),
        latestVersion: release?.tag ?? null,
        releaseName: release?.name ?? null,
        releaseUrl: release?.url ?? null,
        publishedAt: release?.publishedAt ?? null,
      };
      setSetting(KEY_LAST_CHECK, JSON.stringify(fresh));
      return toStatus(fresh, null);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.warn(`[update] check failed: ${reason}`);
      return toStatus(cache, `Update check failed: ${reason}`);
    }
  });
}

/**
 * Start downloading the pending update, and answer with the status the banner
 * should show while it runs. The rest arrives on `updateProgress`.
 *
 * Never rejects, for the same reason `checkForUpdate` doesn't: a download that
 * couldn't start is a sentence beside the banner, not an exception at a button.
 */
export async function downloadUpdate(): Promise<UpdateStatus> {
  await startDownload();
  return toStatus(readCache(), null);
}

/**
 * Quit and install what was downloaded. Returns the status rather than nothing
 * so a refused install (nothing downloaded yet) still tells the renderer why.
 */
export function installUpdate(): UpdateStatus {
  installNow();
  return toStatus(readCache(), null);
}

/**
 * Hide the banner for one version. Anything newer raises it again, so this
 * means "not this one", not "never tell me".
 */
export function dismissUpdate(version: string): UpdateStatus {
  setSetting(KEY_DISMISSED, version);
  return toStatus(readCache(), null);
}
