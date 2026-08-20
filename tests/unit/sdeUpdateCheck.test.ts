import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SdeStatus } from '@shared/types';

/**
 * The static data update check, with CCP's catalogue and the settings table
 * stubbed: what it caches, when it goes out again, and what it says when it
 * can't reach CCP.
 */

const settings = new Map<string, string>();
let installedBuild: string | null = '3351823';

vi.mock('@main/db/repositories/appSettings', () => ({
  getSetting: (key: string) => settings.get(key) ?? null,
  setSetting: (key: string, value: string) => void settings.set(key, value),
}));

vi.mock('@main/db/repositories/sde', () => ({
  getSdeStatus: (): SdeStatus => ({
    installed: installedBuild !== null,
    version: installedBuild,
    importedAt: '2026-01-01T00:00:00Z',
    hasSkillData: true,
    hasMapData: true,
    hasSkillAttributes: true,
    hasBlueprintData: true,
    hasJumpData: true,
  }),
}));

const { checkSdeUpdate, dismissSdeUpdate, resolveSdeDownload } = await import(
  '@main/services/sdeUpdateService'
);

/** One catalogue response, as CCP serves it. */
function catalogue(build: number, releaseDate = '2026-08-19T11:07:27Z'): Response {
  return new Response(`{"_key": "sde", "buildNumber": ${build}, "releaseDate": "${releaseDate}"}\n`, {
    status: 200,
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  settings.clear();
  installedBuild = '3351823';
  fetchMock = vi.fn(async () => catalogue(3473160));
  vi.stubGlobal('fetch', fetchMock);
  // console.warn is the failure path's own reporting; keep it out of the run.
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('checkSdeUpdate', () => {
  it('reports a newer build than the one imported', async () => {
    const status = await checkSdeUpdate();

    expect(status.latestBuild).toBe('3473160');
    expect(status.installedBuild).toBe('3351823');
    expect(status.updateAvailable).toBe(true);
    expect(status.releasedAt).toBe('2026-08-19T11:07:27Z');
    expect(status.message).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('says nothing is available once that build is imported', async () => {
    installedBuild = '3473160';

    const status = await checkSdeUpdate();

    expect(status.updateAvailable).toBe(false);
    expect(status.latestBuild).toBe('3473160');
  });

  it('answers from the cache for a day, and refetches when forced', async () => {
    await checkSdeUpdate();
    await checkSdeUpdate();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await checkSdeUpdate(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('refetches once the cached answer has aged out', async () => {
    settings.set(
      'sde.lastCheck',
      JSON.stringify({
        checkedAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
        build: '3400000',
        releasedAt: null,
      }),
    );

    expect((await checkSdeUpdate()).latestBuild).toBe('3473160');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps the last known answer when CCP cannot be reached', async () => {
    await checkSdeUpdate();
    fetchMock.mockRejectedValue(new Error('getaddrinfo ENOTFOUND'));

    const status = await checkSdeUpdate(true);

    // The failure is described, not thrown, and it does not erase what was
    // already learned.
    expect(status.latestBuild).toBe('3473160');
    expect(status.updateAvailable).toBe(true);
    expect(status.message).toContain('ENOTFOUND');
  });

  it('does not invent an answer from an unreadable catalogue', async () => {
    fetchMock.mockResolvedValue(new Response('<html>404</html>', { status: 200 }));

    const status = await checkSdeUpdate();

    expect(status.latestBuild).toBeNull();
    expect(status.updateAvailable).toBe(false);
    expect(status.message).toContain('named no build');
    expect(settings.has('sde.lastCheck')).toBe(false);
  });

  it('collapses concurrent checks into one request', async () => {
    const [a, b] = await Promise.all([checkSdeUpdate(true), checkSdeUpdate(true)]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a.latestBuild).toBe(b.latestBuild);
  });

  it('explains an import that recorded no build number', async () => {
    installedBuild = 'unknown';

    const status = await checkSdeUpdate();

    expect(status.updateAvailable).toBe(false);
    expect(status.message).toContain('no build number');
  });
});

describe('dismissSdeUpdate', () => {
  it('hides one build, and only that build', async () => {
    await checkSdeUpdate();

    expect(dismissSdeUpdate('3473160').dismissed).toBe(true);
    // The next build CCP publishes raises the banner again.
    fetchMock.mockResolvedValue(catalogue(3500000));
    expect((await checkSdeUpdate(true)).dismissed).toBe(false);
  });
});

describe('resolveSdeDownload', () => {
  it('imports the build CCP currently publishes', async () => {
    expect(await resolveSdeDownload()).toEqual({
      build: '3473160',
      url: 'https://developers.eveonline.com/static-data/tranquility/eve-online-static-data-3473160-yaml.zip',
    });
  });

  it('falls back to the pinned build when the catalogue is unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));

    // Old data beats no data: an import still has to be possible offline of
    // CCP's catalogue but online to its CDN.
    expect(await resolveSdeDownload()).toEqual({
      build: '3351823',
      url: 'https://developers.eveonline.com/static-data/tranquility/eve-online-static-data-3351823-yaml.zip',
    });
  });
});
