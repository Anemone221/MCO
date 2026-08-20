import { createSingleFlight } from '../auth/singleFlight';
import { SDE_PINNED_BUILD, SDE_URL, SDE_URL_OVERRIDE, sdeZipUrl } from '../config';
import { getSetting, setSetting } from '../db/repositories/appSettings';
import { getSdeStatus } from '../db/repositories/sde';
import { fetchLatestSdeRelease, isNewerBuild, normalizeBuild } from '../sde/latest';
import type { SdeUpdateStatus } from '@shared/types';

/**
 * Whether CCP has published a newer static data build than the one imported.
 *
 * This is the half of SDE upkeep that used to require a release of MCO: the
 * download URL carried a build number compiled into `config.ts`, so a patch
 * that added a ship or a skill left every install blind to it until someone
 * bumped the constant. The build number is now discovered here, which makes a
 * game patch a re-import the user can run themselves.
 *
 * Deliberately shaped like `updateService.ts` — a cached answer in
 * `app_settings`, refreshed at most daily, dismissible per build, and never
 * rejecting. The catalogue is 80 bytes behind a CDN, so the interval is
 * politeness rather than a rate limit, and it keeps a launch from waiting on
 * the network before the banner can say anything.
 *
 * Nothing downloads on its own: a check only raises the banner. The ~100 MB
 * zip moves when the user clicks.
 */
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

const KEY_LAST_CHECK = 'sde.lastCheck';
const KEY_DISMISSED = 'sde.dismissedBuild';

/** The last *successful* check. A failure never overwrites one. */
interface CachedCheck {
  checkedAt: string;
  build: string;
  releasedAt: string | null;
}

// One key: the banner and the Settings page mounting together make one request,
// not two.
const inFlight = createSingleFlight<'sde', SdeUpdateStatus>();

function readCache(): CachedCheck | null {
  const raw = getSetting(KEY_LAST_CHECK);
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as CachedCheck;
    // A truncated or hand-edited value reads as "never checked" rather than
    // throwing on a page load.
    return typeof parsed?.checkedAt === 'string' && typeof parsed?.build === 'string'
      ? parsed
      : null;
  } catch {
    return null;
  }
}

/**
 * Whether MCO checks on its own.
 *
 * On by default everywhere, unlike the app-update check: static data goes stale
 * with the game, not with the build, so `npm run dev` needs the answer as much
 * as an installed copy does. `MCO_SDE_CHECK=0` opts out — what the E2E suites
 * set to stay off the network.
 */
function autoCheckEnabled(): boolean {
  return process.env['MCO_SDE_CHECK'] !== '0';
}

/**
 * Compose the renderer's view from the cached check and the build actually in
 * the database.
 *
 * `failure` describes this attempt while the cache holds the last thing learned,
 * so a check that couldn't reach CCP leaves the previous answer on screen with
 * a sentence saying why it didn't move.
 */
function toStatus(cache: CachedCheck | null, failure: string | null): SdeUpdateStatus {
  const installedBuild = getSdeStatus().version;
  const latestBuild = cache?.build ?? null;
  const updateAvailable = isNewerBuild(latestBuild, installedBuild);

  // An import that recorded no build number can't be compared against one. Say
  // that, rather than let "no update" read as confirmation it is current.
  const unreadableInstall =
    latestBuild !== null && installedBuild !== null && normalizeBuild(installedBuild) === null
      ? 'The imported static data has no build number — re-import to compare it.'
      : null;

  return {
    installedBuild,
    latestBuild,
    releasedAt: cache?.releasedAt ?? null,
    checkedAt: cache?.checkedAt ?? null,
    updateAvailable,
    dismissed: latestBuild !== null && getSetting(KEY_DISMISSED) === latestBuild,
    message: failure ?? unreadableInstall,
  };
}

/**
 * The current answer, refreshing it first when the cached one has aged out.
 * `force` skips the interval (the "Check now" button, and the import itself).
 *
 * Never rejects: a failed check is a sentence beside a banner, not an exception
 * at a page load.
 */
export async function checkSdeUpdate(force = false): Promise<SdeUpdateStatus> {
  if (SDE_URL_OVERRIDE !== null) {
    // The import will fetch that exact zip, so offering whatever CCP publishes
    // would promise a build the download won't deliver.
    return toStatus(null, 'The static data build is pinned by MCO_SDE_URL.');
  }
  if (!force && !autoCheckEnabled()) {
    return toStatus(readCache(), 'Static data update checks are off in this build.');
  }

  const cache = readCache();
  const age = cache === null ? Number.NaN : Date.now() - Date.parse(cache.checkedAt);
  // NaN (never checked, or an unparseable timestamp) fails this and refetches.
  if (!force && age < CHECK_INTERVAL_MS) return toStatus(cache, null);

  return inFlight.run('sde', async () => {
    try {
      const release = await fetchLatestSdeRelease();
      const fresh: CachedCheck = {
        checkedAt: new Date().toISOString(),
        build: release.build,
        releasedAt: release.releasedAt,
      };
      setSetting(KEY_LAST_CHECK, JSON.stringify(fresh));
      return toStatus(fresh, null);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.warn(`[sde] update check failed: ${reason}`);
      return toStatus(cache, `Static data check failed: ${reason}`);
    }
  });
}

/**
 * Hide the banner for one build. A build after it raises the banner again, so
 * this means "not this one", not "stop telling me".
 */
export function dismissSdeUpdate(build: string): SdeUpdateStatus {
  setSetting(KEY_DISMISSED, build);
  return toStatus(readCache(), null);
}

/**
 * Which zip an import should fetch: the newest build CCP publishes.
 *
 * Checked fresh rather than off the daily cache — the catalogue costs 80 bytes
 * against a download three orders of magnitude larger, and someone who clicks
 * "import" is asking for current data, not for yesterday's answer. A check that
 * fails falls back to the pinned build, because an old SDE resolves almost
 * every id and no SDE resolves none.
 */
export async function resolveSdeDownload(): Promise<{ url: string; build: string }> {
  if (SDE_URL_OVERRIDE !== null) return { url: SDE_URL_OVERRIDE, build: 'pinned' };

  const status = await checkSdeUpdate(true);
  return status.latestBuild === null
    ? { url: SDE_URL, build: SDE_PINNED_BUILD }
    : { url: sdeZipUrl(status.latestBuild), build: status.latestBuild };
}
