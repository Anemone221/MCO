/**
 * Decides when a player-owned structure's ESI record is worth (re)fetching.
 * Dependency-free so unit tests need no Electron/DB.
 *
 * Structures rarely change (rename, ownership transfer), so resolved rows are
 * refreshed on a slow cadence. Failed lookups usually mean the token lost
 * docking access — ESI answers 403, which counts against the error limit, so
 * retries are throttled hard.
 */

export interface StructureFreshness {
  /** Last successful ESI fetch; null when the id has never resolved. */
  resolvedAt: string | null;
  /** Last failed attempt (403 access denied, etc.); null when never failed. */
  failedAt: string | null;
}

const RESOLVED_TTL_MS = 7 * 24 * 3_600_000; // re-check resolved structures weekly
const FAILED_RETRY_MS = 24 * 3_600_000; // retry inaccessible structures daily

/**
 * True when the structure should be fetched from ESI now. An unknown id
 * (undefined row) is always due; otherwise the most recent attempt — success
 * or failure — gates the next one.
 */
export function isStructureDue(
  row: StructureFreshness | undefined,
  now: Date = new Date(),
): boolean {
  if (!row) return true;
  const resolved = row.resolvedAt ? Date.parse(row.resolvedAt) : null;
  const failed = row.failedAt ? Date.parse(row.failedAt) : null;
  const lastAttempt = Math.max(resolved ?? -Infinity, failed ?? -Infinity);
  if (lastAttempt === -Infinity) return true;
  const failedMoreRecently = failed !== null && (resolved === null || failed > resolved);
  const ttl = failedMoreRecently ? FAILED_RETRY_MS : RESOLVED_TTL_MS;
  return now.getTime() - lastAttempt >= ttl;
}
