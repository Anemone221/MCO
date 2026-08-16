import { app } from 'electron';
import type { UpdateStatus } from '@shared/types';
import { createSingleFlight } from '../auth/singleFlight';
import { APP_VERSION, GITHUB_RELEASES_URL, GITHUB_URL, USER_AGENT } from '../config';
import { getSetting, setSetting } from '../db/repositories/appSettings';
import { latestReleaseApiUrl, parseRelease, type ReleaseInfo } from '../update/github';
import { isNewerVersion } from '../update/version';

/**
 * Noticing that a newer MCO has been released.
 *
 * MCO is installed from a GitHub release and updated by hand, so this only ever
 * *looks*: nothing is downloaded, nothing is installed, and a user who ignores
 * the banner keeps running what they have. (In-place updating is
 * `electron-updater`'s job and would need a signed installer to be worth
 * offering.)
 *
 * The check is unauthenticated, and GitHub allows 60 API requests an hour per
 * IP shared across every unauthenticated caller on it — so the answer is cached
 * in `app_settings` and refreshed at most daily. Settings → "Check now"
 * bypasses the interval for a user who wants an answer immediately.
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
 * Compose the renderer's view from the cached check plus, when the check that
 * just ran failed, why. `failure` is deliberately not persisted: it describes
 * this attempt, while the cache holds the last thing actually learned.
 */
function toStatus(cache: CachedCheck | null, failure: string | null): UpdateStatus {
  const latestVersion = cache?.latestVersion ?? null;
  const available = latestVersion !== null && isNewerVersion(latestVersion, APP_VERSION);

  return {
    state: latestVersion === null ? 'unknown' : available ? 'update-available' : 'current',
    currentVersion: APP_VERSION,
    latestVersion,
    releaseName: cache?.releaseName ?? null,
    releaseUrl: cache?.releaseUrl ?? GITHUB_RELEASES_URL,
    publishedAt: cache?.publishedAt ?? null,
    checkedAt: cache?.checkedAt ?? null,
    message:
      failure ??
      (cache !== null && latestVersion === null ? 'No releases have been published yet.' : null),
    dismissed: latestVersion !== null && getSetting(KEY_DISMISSED) === latestVersion,
  };
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
      const release = await fetchLatestRelease();
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
 * Hide the banner for one version. Anything newer raises it again, so this
 * means "not this one", not "never tell me".
 */
export function dismissUpdate(version: string): UpdateStatus {
  setSetting(KEY_DISMISSED, version);
  return toStatus(readCache(), null);
}
