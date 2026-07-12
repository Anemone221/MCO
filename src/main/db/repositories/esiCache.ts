import { getDb } from '../index';

export interface CachedResponse {
  url: string;
  etag: string | null;
  expiresAt: string | null;
  body: string;
}

interface CacheRow {
  url: string;
  etag: string | null;
  expires_at: string | null;
  body: string;
}

export function getCached(url: string): CachedResponse | null {
  const row = getDb()
    .prepare('SELECT url, etag, expires_at, body FROM esi_cache WHERE url = ?')
    .get(url) as CacheRow | undefined;
  if (!row) return null;
  return { url: row.url, etag: row.etag, expiresAt: row.expires_at, body: row.body };
}

export function putCached(entry: CachedResponse): void {
  getDb()
    .prepare(
      `INSERT INTO esi_cache (url, etag, expires_at, body, cached_at)
       VALUES (@url, @etag, @expiresAt, @body, datetime('now'))
       ON CONFLICT(url) DO UPDATE SET
         etag = excluded.etag,
         expires_at = excluded.expires_at,
         body = excluded.body,
         cached_at = excluded.cached_at`,
    )
    .run(entry);
}

/** True when a cached entry exists and its Expires timestamp is still in the future. */
export function isFresh(entry: CachedResponse | null): boolean {
  if (!entry?.expiresAt) return false;
  const expires = new Date(entry.expiresAt).getTime();
  return !Number.isNaN(expires) && expires > Date.now();
}
