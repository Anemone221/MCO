import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The switch that decides whether MCO looks for releases on its own, with the
 * settings table and the updater stubbed: what a profile that has never been
 * asked does (nothing, and no network), what each answer does to the check and
 * to the install-on-quit, and what an existing profile is assumed to have
 * consented to already.
 *
 * The env var is the build-level half of the same question, so it is exercised
 * here too — `MCO_UPDATE_CHECK=0` has to hold whatever a profile stored, or the
 * packaged smoke test would depend on which profile it ran against.
 */

const settings = new Map<string, string>();
let autoInstallOnQuit: boolean | null = null;

vi.mock('electron', () => ({
  app: { isPackaged: true },
}));

vi.mock('@main/db/repositories/appSettings', () => ({
  getSetting: (key: string) => settings.get(key) ?? null,
  setSetting: (key: string, value: string) => void settings.set(key, value),
}));

// The updater itself never runs here: `isUpdaterAvailable` false sends the
// check down the REST path, which is the one a stubbed `fetch` can answer.
vi.mock('@main/services/autoUpdate', () => ({
  initAutoUpdate: () => {},
  isUpdaterAvailable: () => false,
  getEngineState: () => ({ phase: 'idle', percent: 0, version: null, error: null }),
  runCheck: async () => null,
  startDownload: async () => {},
  installNow: () => {},
  setAutoInstallOnQuit: (enabled: boolean) => void (autoInstallOnQuit = enabled),
}));

const { checkForUpdate, getAutoCheck, initUpdates, setAutoCheckUpdate } = await import(
  '@main/services/updateService'
);

/** GitHub's `/releases/latest`, as the REST path reads it. */
function release(tag: string): Response {
  return new Response(
    JSON.stringify({
      tag_name: tag,
      name: tag,
      html_url: `https://github.com/Anemone221/MCO/releases/tag/${tag}`,
      published_at: '2026-08-19T11:07:27Z',
      draft: false,
      prerelease: false,
    }),
    { status: 200 },
  );
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  settings.clear();
  autoInstallOnQuit = null;
  delete process.env['MCO_UPDATE_CHECK'];
  fetchMock = vi.fn(async () => release('v9.9.9'));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('getAutoCheck', () => {
  it('starts out unanswered on a fresh profile', () => {
    expect(getAutoCheck()).toBe('unset');
  });

  it('reports the stored answer', async () => {
    await setAutoCheckUpdate(false);
    expect(getAutoCheck()).toBe('off');

    await setAutoCheckUpdate(true);
    expect(getAutoCheck()).toBe('on');
  });

  it('is unavailable where the build would never check anyway', async () => {
    await setAutoCheckUpdate(true);
    process.env['MCO_UPDATE_CHECK'] = '0';

    // The stored yes is untouched — it applies again if the build changes its
    // mind — but nothing in this run acts on it.
    expect(getAutoCheck()).toBe('unavailable');
    expect(settings.get('update.autoCheck')).toBe('1');
  });
});

describe('checkForUpdate', () => {
  it('asks nobody until the profile has answered', async () => {
    const status = await checkForUpdate();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(status.autoCheck).toBe('unset');
    expect(status.state).toBe('unknown');
    // No message: the banner asks the question, and a sentence here would be
    // answering it in the user's stead.
    expect(status.message).toBeNull();
  });

  it('checks once the answer is yes', async () => {
    const status = await setAutoCheckUpdate(true);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(status.autoCheck).toBe('on');
    expect(status.state).toBe('update-available');
    expect(status.latestVersion).toBe('v9.9.9');
  });

  it('stays off the network once the answer is no, and says why', async () => {
    await setAutoCheckUpdate(false);

    const status = await checkForUpdate();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(status.autoCheck).toBe('off');
    expect(status.message).toBe('Automatic update checks are off.');
  });

  it('still answers an explicit check with automatic checks off', async () => {
    await setAutoCheckUpdate(false);

    const status = await checkForUpdate(true);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(status.state).toBe('update-available');
    expect(status.autoCheck).toBe('off');
  });

  it('leaves the build switch to govern the automatic path only', async () => {
    process.env['MCO_UPDATE_CHECK'] = '0';

    expect((await checkForUpdate()).message).toBe('Automatic update checks are off in this build.');
    expect(fetchMock).not.toHaveBeenCalled();

    // Settings → "Check for updates" is a person asking, and is answered in
    // every build. What MCO_UPDATE_CHECK=0 buys the packaged smoke test is a
    // run that makes no request nobody made.
    const forced = await checkForUpdate(true);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(forced.state).toBe('update-available');
    expect(forced.autoCheck).toBe('unavailable');
  });
});

describe('setAutoCheckUpdate', () => {
  it('stands the install-on-quit down with it, and back up again', async () => {
    await setAutoCheckUpdate(false);
    expect(autoInstallOnQuit).toBe(false);

    await setAutoCheckUpdate(true);
    expect(autoInstallOnQuit).toBe(true);
  });
});

describe('initUpdates', () => {
  it('leaves a first launch to be asked', () => {
    initUpdates(() => null);

    expect(getAutoCheck()).toBe('unset');
    expect(autoInstallOnQuit).toBe(true);
  });

  it('takes an already-checking profile as having consented', () => {
    // Written by a version that had no switch: this profile has been checking
    // daily all along, so asking now would be asking about the status quo.
    settings.set(
      'update.lastCheck',
      JSON.stringify({
        checkedAt: new Date().toISOString(),
        latestVersion: 'v0.2.0',
        releaseName: null,
        releaseUrl: null,
        publishedAt: null,
      }),
    );

    initUpdates(() => null);

    expect(getAutoCheck()).toBe('on');
  });

  it('does not undo an answer of no', () => {
    settings.set('update.autoCheck', '0');
    settings.set(
      'update.lastCheck',
      JSON.stringify({
        checkedAt: new Date().toISOString(),
        latestVersion: 'v0.2.0',
        releaseName: null,
        releaseUrl: null,
        publishedAt: null,
      }),
    );

    initUpdates(() => null);

    expect(getAutoCheck()).toBe('off');
    expect(autoInstallOnQuit).toBe(false);
  });
});
