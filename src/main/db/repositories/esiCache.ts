import { getDb } from '../index';

export interface CachedResponse {
  url: string;
  etag: string | null;
  expiresAt: string | null;
  body: string;
  /**
   * `X-Pages` from the response, when it had one. Stored rather than derived
   * because a fresh cache hit skips the request entirely — without it a paged
   * read served from cache could not tell one page from ten.
   */
  pages: number | null;
}

interface CacheRow {
  url: string;
  etag: string | null;
  expires_at: string | null;
  body: string;
  pages: number | null;
}

export function getCached(url: string): CachedResponse | null {
  const row = getDb()
    .prepare('SELECT url, etag, expires_at, body, pages FROM esi_cache WHERE url = ?')
    .get(url) as CacheRow | undefined;
  if (!row) return null;
  return {
    url: row.url,
    etag: row.etag,
    expiresAt: row.expires_at,
    body: row.body,
    pages: row.pages,
  };
}

export function putCached(entry: CachedResponse): void {
  getDb()
    .prepare(
      `INSERT INTO esi_cache (url, etag, expires_at, body, pages, cached_at)
       VALUES (@url, @etag, @expiresAt, @body, @pages, datetime('now'))
       ON CONFLICT(url) DO UPDATE SET
         etag = excluded.etag,
         expires_at = excluded.expires_at,
         body = excluded.body,
         pages = excluded.pages,
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
