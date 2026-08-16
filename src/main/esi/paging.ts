/**
 * The page loop behind `esiGetPaged` ({@link ../esi/client}), kept dependency-free
 * so the stopping rules can be tested without Electron, the cache DB or a network.
 *
 * ESI publishes the total page count in `X-Pages` on every page of a paginated
 * route, so paging is a bounded `for` over a number the server gave us. That is
 * the whole point of this module: the consumers it replaces each invented their
 * own stopping rule — "a short page is the last page", "a 404 means the end" —
 * and the 404 rule doubled as an error handler, so a throttle give-up or a 500
 * read as "no more pages" and truncated the result (docs/release-review.md §1.5).
 * Here nothing is inferred from a failure: a failed page rejects the whole read,
 * which leaves the caller's stored data alone instead of replacing it with a
 * short one.
 */

/** One page as fetched: its items, plus the page count the server reported. */
export interface PageResult<T> {
  data: T[];
  /** `X-Pages`, or null when the response carried no such header. */
  pages: number | null;
}

export interface PagingOptions<T> {
  /**
   * Ceiling on pages fetched, regardless of what `X-Pages` reports. A guard
   * against a collection of unexpected size turning one sync into thousands of
   * requests, not a correctness rule.
   */
  maxPages?: number;
  /**
   * Consulted after each page is collected; returning true ends the read there.
   * For endpoints ordered newest-first this is how a caller says "far enough
   * back" without reading history it will discard anyway.
   */
  stopAfter?: (page: T[], pageNumber: number) => boolean;
}

/**
 * Fetch page 1, then every remaining page `X-Pages` announced, and return the
 * concatenation in page order.
 *
 * A response without `X-Pages` is a single page — every paginated ESI route
 * sends the header, so its absence means the route isn't paginated rather than
 * "count unknown".
 *
 * The page count is read once, from page 1. A collection that shrinks mid-read
 * can therefore leave a page that no longer exists: that 404 propagates like any
 * other failure, and the next sync (which re-reads the count) sees the new size.
 */
export async function collectPages<T>(
  fetchPage: (page: number) => Promise<PageResult<T>>,
  options: PagingOptions<T> = {},
): Promise<T[]> {
  const { maxPages, stopAfter } = options;

  const first = await fetchPage(1);
  const items = [...first.data];
  if (stopAfter?.(first.data, 1)) return items;

  const lastPage = Math.min(first.pages ?? 1, maxPages ?? Number.MAX_SAFE_INTEGER);
  for (let page = 2; page <= lastPage; page += 1) {
    const next = await fetchPage(page);
    items.push(...next.data);
    if (stopAfter?.(next.data, page)) break;
  }
  return items;
}
