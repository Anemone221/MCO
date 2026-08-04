import { existsSync, readdirSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import { appEnv } from '../support/electronEnv';

/**
 * Smoke tests for the packaged app (`npm run dist:dir`).
 *
 * electron-builder exiting 0 does not mean the package works: a bad `files`
 * glob, an `asarUnpack` regression for better-sqlite3, or renderer assets that
 * never made it into the archive all produce a "successful" build of a broken
 * app. These tests assert the packaging invariants, then boot the real binary.
 *
 * (A missing app icon is caught by electron-builder itself — it fails the build
 * when `win.icon` points at a file that isn't there.)
 */

/** Where `directories.output` in electron-builder.yml puts the package. */
const releaseDir = resolve(process.cwd(), 'release');

interface PackagedApp {
  /** The binary to launch. */
  executable: string;
  /** Directory holding `app.asar` and `app.asar.unpacked`. */
  resourcesDir: string;
}

function locatePackagedApp(): PackagedApp {
  if (!existsSync(releaseDir)) {
    throw new Error(`No packaged build at ${releaseDir} — run \`npm run dist:dir\` first.`);
  }

  if (process.platform === 'win32') {
    const appDir = join(releaseDir, 'win-unpacked');
    return { executable: join(appDir, 'MCO.exe'), resourcesDir: join(appDir, 'resources') };
  }

  if (process.platform === 'darwin') {
    // release/mac, release/mac-arm64 or release/mac-universal, depending on arch.
    const macDir = readdirSync(releaseDir).find((entry) => entry.startsWith('mac'));
    if (macDir === undefined) throw new Error(`No mac* directory in ${releaseDir}.`);
    const bundle = join(releaseDir, macDir, 'MCO.app', 'Contents');
    return {
      executable: join(bundle, 'MacOS', 'MCO'),
      resourcesDir: join(bundle, 'Resources'),
    };
  }

  // Linux: electron-builder derives the executable name from the package name.
  const appDir = join(releaseDir, 'linux-unpacked');
  const executable = ['mco', 'MCO']
    .map((name) => join(appDir, name))
    .find((candidate) => existsSync(candidate));
  if (executable === undefined) throw new Error(`No mco executable in ${appDir}.`);
  return { executable, resourcesDir: join(appDir, 'resources') };
}

test('packages the native module and icons outside the asar', () => {
  const { executable, resourcesDir } = locatePackagedApp();

  expect(existsSync(executable), `missing executable: ${executable}`).toBe(true);

  const asar = join(resourcesDir, 'app.asar');
  expect(existsSync(asar), `missing app.asar: ${asar}`).toBe(true);

  // better-sqlite3 ships a native .node binary that cannot be loaded from
  // inside an asar archive, so asarUnpack must keep it on disk.
  const unpacked = join(resourcesDir, 'app.asar.unpacked');
  const nativeModule = join(
    unpacked,
    'node_modules',
    'better-sqlite3',
    'build',
    'Release',
    'better_sqlite3.node',
  );
  expect(existsSync(nativeModule), 'better-sqlite3 was packed into the asar').toBe(true);

  // nativeImage does not reliably read window/tray icons from inside an asar,
  // so resources/ is unpacked too. A silently missing tray icon means no
  // reachable UI in background mode.
  for (const icon of ['icon.png', 'tray.png', 'tray@2x.png']) {
    const path = join(unpacked, 'resources', icon);
    expect(existsSync(path), `missing unpacked icon: ${path}`).toBe(true);
  }
});

test('packaged app boots against an empty profile', async () => {
  const { executable } = locatePackagedApp();
  const userDataDir = await mkdtemp(join(tmpdir(), 'mco-packaged-'));

  const app = await electron.launch({
    executablePath: executable,
    args: ['--no-sandbox', `--user-data-dir=${userDataDir}`],
    env: appEnv(),
  });

  // Getting a window at all means the main process bundle loaded out of the
  // asar and getDb() opened SQLite — i.e. better_sqlite3.node resolved from
  // app.asar.unpacked and the migrations ran.
  const window = await app.firstWindow();

  // Renderer assets made it into the package too.
  await expect(window.locator('h1')).toHaveText('MCO');
  await expect(window.getByTestId('dashboard-tiles')).toBeVisible();
  await expect(window.locator('.empty-state h3')).toHaveText('No characters yet');

  await app.close();
});
