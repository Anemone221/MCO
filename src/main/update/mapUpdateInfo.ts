/**
 * Turning what `electron-updater` reports about a release into the same
 * `ReleaseInfo` the GitHub REST check produces.
 *
 * MCO learns about a release two ways — the updater's own feed in a packaged
 * build, GitHub's API everywhere else — and both must cache the *same* shape, or
 * the banner would word itself differently depending on which one ran. Pure, so
 * it unit-tests beside the other `update/` modules without Electron.
 */

import type { ReleaseInfo } from './github';

/**
 * The fields MCO reads out of `electron-updater`'s `UpdateInfo`, declared
 * structurally rather than imported: this module stays free of the updater (and
 * therefore of Electron) so its tests do.
 */
export interface UpdateInfoLike {
  version: string;
  releaseName?: string | null;
  releaseDate?: string | null;
}

/**
 * `0.2.1` → `v0.2.1`.
 *
 * `electron-updater` reports the bare version out of `latest.yml`, while a
 * release is tagged `v0.2.1` and that is what the REST path caches and the
 * banner prints. Normalizing here keeps one spelling in `app_settings`.
 */
export function toTag(version: string): string {
  return version.startsWith('v') ? version : `v${version}`;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * A cacheable release, or null when the updater reported one without a version.
 *
 * The release page is composed rather than reported: `latest.yml` describes the
 * artifacts, not the GitHub page they hang off, so the URL is derived from the
 * repository the same way the tag is.
 */
export function releaseFromUpdateInfo(info: UpdateInfoLike, repoUrl: string): ReleaseInfo | null {
  const version = stringOrNull(info?.version);
  if (version === null) return null;

  const tag = toTag(version);
  return {
    tag,
    name: stringOrNull(info.releaseName),
    url: `${repoUrl.replace(/\/+$/, '')}/releases/tag/${tag}`,
    publishedAt: stringOrNull(info.releaseDate),
  };
}
