import { describe, expect, it, vi } from 'vitest';
import { collectPages, type PageResult } from '@main/esi/paging';

/**
 * A stub ESI route: `pages` fixed-size pages of numbered items, reporting its
 * own page count in every page's X-Pages exactly as ESI does.
 */
function fakeRoute(pages: number, perPage = 3) {
  const fetchPage = vi.fn(
    async (page: number): Promise<PageResult<string>> => ({
      data: Array.from({ length: perPage }, (_, i) => `p${page}-${i}`),
      pages,
    }),
  );
  return fetchPage;
}

describe('collectPages', () => {
  it('reads every page X-Pages announced, in order', async () => {
    const fetchPage = fakeRoute(3, 2);

    const items = await collectPages(fetchPage);

    expect(items).toEqual(['p1-0', 'p1-1', 'p2-0', 'p2-1', 'p3-0', 'p3-1']);
    expect(fetchPage.mock.calls.map(([page]) => page)).toEqual([1, 2, 3]);
  });

  it('stops after page 1 when the route reports one page', async () => {
    const fetchPage = fakeRoute(1);

    await collectPages(fetchPage);

    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it('treats a missing X-Pages as a single page', async () => {
    // Non-paginated routes send no X-Pages at all; probing for a page 2 there
    // would spend an error-limit slot on a guaranteed 404.
    const fetchPage = vi.fn(async () => ({ data: ['only'], pages: null }));

    expect(await collectPages(fetchPage)).toEqual(['only']);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it('never reads past maxPages, however many pages exist', async () => {
    const fetchPage = fakeRoute(50, 1);

    const items = await collectPages(fetchPage, { maxPages: 2 });

    expect(items).toEqual(['p1-0', 'p2-0']);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it('stops early when stopAfter says the read has gone far enough', async () => {
    const fetchPage = fakeRoute(10, 1);

    const items = await collectPages(fetchPage, {
      stopAfter: (_page, pageNumber) => pageNumber === 3,
    });

    expect(items).toEqual(['p1-0', 'p2-0', 'p3-0']);
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });

  it('keeps the page that satisfied stopAfter', async () => {
    // The wallet journal's rule fires on the page that crosses the lookback
    // window, and that page still holds the entries inside it.
    const fetchPage = fakeRoute(5, 2);

    expect(await collectPages(fetchPage, { stopAfter: () => true })).toEqual(['p1-0', 'p1-1']);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it('propagates a failed page instead of treating it as the end', async () => {
    // The bug this loop exists to prevent: a 500 or a throttle give-up on page 2
    // used to read as "no more pages", and the truncated list then replaced the
    // caller's stored rows. Rejecting leaves the previous data alone.
    const fetchPage = vi.fn(async (page: number): Promise<PageResult<string>> => {
      if (page === 2) throw new Error('ESI GET failed: 500');
      return { data: [`p${page}`], pages: 3 };
    });

    await expect(collectPages(fetchPage)).rejects.toThrow('500');
  });
});
