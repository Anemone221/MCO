/**
 * Which SDE build CCP currently publishes.
 *
 * The build number is the whole point of this module: MCO's static data goes
 * stale every time EVE patches in a ship, skill or blueprint, and the fix is a
 * re-import of a newer zip — not a new MCO. Reading CCP's catalogue at runtime
 * is what lets a user follow the game without waiting on a release here.
 *
 * Parsing and comparison are pure so they unit-test without a network; only
 * `fetchLatestSdeRelease` goes out.
 */
import { SDE_LATEST_URL, USER_AGENT } from '../config';

/** One published SDE build. */
export interface SdeRelease {
  /** The build number, as it appears in the zip's filename. */
  build: string;
  /** ISO timestamp CCP published it, when the catalogue carried one. */
  releasedAt: string | null;
}

const REQUEST_TIMEOUT_MS = 10_000;

/** The catalogue line MCO reads; other datasets may share the file. */
const SDE_KEY = 'sde';

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * A build number as text, or null when it is not one.
 *
 * CCP writes it as a JSON number; it is kept as a string everywhere else
 * because that is how it appears in a URL and how it is stamped into
 * `sde_version`. Only whole positive numbers count — a float or a build "name"
 * is something this comparison cannot order, and guessing would be worse than
 * saying nothing.
 */
export function normalizeBuild(value: unknown): string | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? String(value) : null;
  }
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^[0-9]+$/.test(trimmed) && Number(trimmed) > 0 ? String(Number(trimmed)) : null;
}

/**
 * Read the newest SDE build out of `latest.jsonl`.
 *
 * The file is JSON *lines*: one object per line, and CCP may add datasets to it
 * that are not the SDE — so the `sde` entry is picked by `_key` rather than by
 * position. A line that doesn't parse is skipped, not thrown on: a catalogue
 * that grew a field or a comment should not break the check.
 *
 * Null means the body carried no SDE build, which is a failed check rather than
 * an answer — unlike a missing GitHub release, CCP always has a current SDE.
 */
export function parseLatestBuild(text: string): SdeRelease | null {
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;

    let entry: unknown;
    try {
      entry = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (typeof entry !== 'object' || entry === null) continue;

    const record = entry as Record<string, unknown>;
    if (stringOrNull(record['_key']) !== SDE_KEY) continue;

    const build = normalizeBuild(record['buildNumber']);
    if (build === null) continue;
    return { build, releasedAt: stringOrNull(record['releaseDate']) };
  }
  return null;
}

/**
 * True when `latest` is a build after `installed`.
 *
 * False whenever either side can't be read as a build number — nothing
 * imported, or a version stamp from a zip whose `_sde.yaml` had none. An
 * unreadable side is a reason to say nothing, never a reason to prompt a
 * 100 MB download.
 */
export function isNewerBuild(latest: string | null, installed: string | null): boolean {
  const next = normalizeBuild(latest);
  const current = normalizeBuild(installed);
  if (next === null || current === null) return false;
  return Number(next) > Number(current);
}

/** Ask CCP which build is current. Rejects when the catalogue can't be read. */
export async function fetchLatestSdeRelease(): Promise<SdeRelease> {
  const response = await fetch(SDE_LATEST_URL, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/jsonlines+json, application/json' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Static data catalogue responded ${response.status}.`);

  const release = parseLatestBuild(await response.text());
  if (release === null) throw new Error('Static data catalogue named no build.');
  return release;
}
