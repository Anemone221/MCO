# Development

## Prerequisites

- Node.js ≥ 20.19 (CI uses 22)
- `npm ci` (postinstall runs `electron-builder install-app-deps` to rebuild
  better-sqlite3's native binary against Electron)

## npm scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | electron-vite dev server with hot reload, on the **dev** database (`--db=dev`) |
| `npm run dev:copy` | Same, after replacing the dev database with a copy of prod (`--db=dev --copy-prod`) |
| `npm run dev:prod` | Same, on the real profile database (`--db=prod`) |
| `npm run build` | Build main/preload/renderer into `out/` |
| `npm run start` / `preview` | Run the built app |
| `npm run start:background` | Run the built app tray-only (background sync mode) |
| `npm run typecheck` | `tsconfig.node.json` (main+preload) then `tsconfig.web.json` (renderer) |
| `npm run lint` | eslint (flat config, `eslint.config.mjs`) |
| `npm run format` | prettier --write |
| `npm run test:unit` / `test:unit:watch` | vitest |
| `npm run test:db` | The database-backed suite (`tests/db/`), run inside Electron's Node |
| `npm run test:e2e` | `electron-vite build` then Playwright against the built app |
| `npm run test:packaged` | `dist:dir` then Playwright against the **packaged** binary |
| `npm run dist` | Build + electron-builder installer into `release/` |
| `npm run dist:dir` | Same but unpacked directory (fast, for smoke-testing packaging) |

## Dev and prod databases (`db/dbMode.ts`, `db/devTokens.ts`)

A build run from source shares the installed app's profile folder, so without care a
half-written migration lands on real data. Two launch arguments choose the database:

| Argument | Database |
| --- | --- |
| *(none)* or `--db=prod` | The profile database, `<userData>/mco.sqlite`. What the installed app uses. |
| `--db=dev` | A scratch database, `<userData>/dev/mco.sqlite`. Starts blank; keeps what dev launches put in it. |
| `--db=dev --copy-prod` | Replaces the dev database with a straight copy of prod, then opens it. Later `--db=dev` launches carry on with that copy. |

`npm run dev`, `dev:copy` and `dev:prod` pass these for you. The built app takes them
after npm's `--`:

```
npm run start -- -- --db=dev
npm run start:background -- --db=dev --copy-prod
```

An unrecognised `--db` value, or `--copy-prod` without `--db=dev`, refuses to start
rather than falling back to prod.

- **Testing a migration on real data** is `npm run dev:copy`: the copy is migrated, prod
  is not opened for it. The dev database has its own `dev/backups/` and restore marker,
  so nothing done on dev rotates out a real backup. Logs and the SDE download are shared.
- **A source build asks before it migrates prod.** Migrations only move forward and a
  build refuses a database newer than it understands, so once a dev build has migrated
  prod, the installed release can no longer open it. An unpackaged build on the prod
  database therefore shows a "Migrate the production database?" prompt first; declining
  quits with the database untouched. A packaged build never asks — its migrations arrive
  through the updater and must run on an unattended tray launch. Either way the
  pre-migration snapshot is taken.
- **One at a time.** The dev database lives inside the same profile folder, so the
  single-instance lock covers both: launching with a different `--db` while MCO is
  running (tray included) focuses the running instance and says which database it is on.
- **Logins stay in step.** A copied database holds prod's refresh tokens, and EVE SSO
  retires a refresh token when it is used. A token refreshed on dev is written through
  to the same character in prod, and a dev launch that is not a fresh copy first takes
  prod's current tokens — so neither side is left presenting a consumed token. A
  character signed in on a blank dev database is a separate login and never appears in
  prod.

Settings → About shows the path of the database in use.

## Environment variables

| Variable | Effect |
| --- | --- |
| `MCO_ESI_CLIENT_ID` | Override the committed EVE developer app client_id (`src/main/config.ts`). |
| `MCO_ESI_COMPAT_DATE` | Override the pinned `X-Compatibility-Date` sent with every ESI request (see [esi.md](esi.md#configuration-srcmainconfigts)). |
| `MCO_SDE_URL` | Import this exact SDE zip instead of the build CCP's catalogue names. Also stands the SDE update check down. |
| `MCO_SDE_CHECK` | `0` disables the check for a newer SDE build. Default: on everywhere. |
| `MCO_UPDATE_CHECK` | `1` enables the GitHub release check in a dev build, `0` disables it in a packaged one. Default: packaged builds only. Governs the *automatic* check only — Settings → "Check for updates" is answered in every build — and sits above the user's own on/off preference. |
| `ELECTRON_RENDERER_URL` | Set by electron-vite dev — main loads the dev server instead of the built `index.html`. |
| `MCO_TEST_LOG` | Test-only: `1` lets `tests/db/scheduler.test.ts` print the scheduler's log lines it otherwise silences. |

To use your own EVE application: register at https://developers.eveonline.com/ with
callback URL `http://localhost:8765/callback` and the scopes listed in `ESI_SCOPES`
(`src/main/config.ts`). The client_id is not a secret under PKCE.

## Testing strategy

Four layers, deliberately:

- **Unit (vitest, `tests/unit/`)** — pure logic only, no Electron/DB/network. This is
  why parsers, analysis math, filtering/sorting, scope classification, and queue-drain
  detection live in dependency-free modules. One suite per module, named after it
  (`eft.test.ts` ↔ `fits/eft.ts`, `rosterView.test.ts` ↔ `lib/rosterView.ts`); about 70
  files, so the directory listing is the index rather than a list here.
  - `tests/unit/renderer/` is the one exception: tests whose subject touches **DOM
    globals** (`window`, and the `lib/ipc.ts` demo wrapper hanging off it). Everything
    under `tests/` is type-checked by `tsconfig.node.json`, which has no DOM lib, so
    that directory is excluded there and included by `tsconfig.web.json` instead.
    vitest runs both the same way. Put a test here only when it needs the DOM types —
    pure logic stays in `tests/unit/`.
- **Database-backed (vitest, `tests/db/`, `npm run test:db`)** — real SQLite, real
  migrations, real repositories and services; only Electron and the network are
  stand-ins. This is the layer that runs `syncCharacter`, the login flow and every
  migration, which the pure unit tests cannot reach.
  - **Why its own command.** better-sqlite3 is a native module and `npm install` builds
    it for Electron's ABI, so plain Node cannot load it. `scripts/test-db.mjs` starts
    vitest with the Electron binary in `ELECTRON_RUN_AS_NODE` mode instead: no second
    build, no rebuild step, and the suite exercises the binary the app ships. Config:
    `vitest.db.config.ts`. Extra arguments pass through
    (`npm run test:db -- tests/db/login.test.ts`).
  - **`tests/db/support/electron.ts`** is aliased in for the `electron` module: a
    profile folder, reversible "encryption" for `safeStorage`, a `shell.openExternal`
    that records the URL instead of opening a browser, a `dialog.showMessageBoxSync`
    whose answer a test sets (`setMessageBoxChoice`), `net.isOnline()` behind
    `setOnline()`, and a `powerMonitor` a test can make emit `resume`.
  - **`support/profile.ts` → `useFreshProfile()`** gives each test an empty profile
    folder, so `getDb()` creates a database and runs every migration on it.
  - **`support/fakeEve.ts` → `useFakeEve()`** replaces the global `fetch` with a fake
    EVE SSO and ESI. The real ESI client runs on top of it — caching, ETags, token
    refresh, paging — and tokens are signed with a throwaway RSA key the fake JWKS
    endpoint serves, so signature and claim verification run for real too. Anything a
    test did not answer is a 404 from ESI and an error elsewhere: a test cannot reach the
    network by omission. `seedCharacter()` leaves what a finished login leaves;
    `answerCharacter()` answers every route a full-scope sync reads.
  - `support/setup.ts` turns the ESI request pacer off (it is only waiting, against a
    fake). The concurrency cap and backoff windows are the real ones.
  - Suites: `migrations` (every migration applies; upgrading from *each* earlier version
    reaches the same schema as a fresh install; the pre-migration snapshot),
    `repositories`, `characterSync` (scope gating, the critical/best-effort split, cache
    and ETag behaviour, token refresh and rotation, a failed blueprint page, a fleet
    sync cut short by a dead network), `login` (the SSO round trip over the real
    loopback listener, cancelling, re-authorizing), `dbMode` (the dev/prod switch, the
    prod copy, the migration prompt, token mirroring), `batchReads` (the batched
    repository reads agree with their per-character originals) and `scheduler` (the
    real scheduler under a fake clock: startup sweep, offline skip, sleep/wake
    catch-up, the no-response pause). The login suite binds the real callback port,
    8765.
- **E2E (Playwright, `tests/e2e/app.spec.ts`)** — launches the **built** app
  (`out/main/index.js`) via Playwright's `_electron` against a throwaway temp
  `userData` dir per test, so tests are hermetic and don't touch your real profile.
  Covers: launch/empty states, account/group/tag persistence across restarts, fit and
  plan import, page navigation, notification bell. Config: `playwright.config.ts`
  (sequential, 1 worker — Electron apps don't parallelize well).
- **Packaged smoke (Playwright, `tests/packaged/smoke.spec.ts`)** — runs against the
  output of `npm run dist:dir` rather than `out/`, because electron-builder exiting 0
  does not mean the package works. Asserts the packaging invariants (`app.asar` exists,
  better-sqlite3's `.node` and `resources/*.png` are unpacked beside it) and then boots
  the real `MCO.exe` against a temp profile — a bad `files` glob or an `asarUnpack`
  regression produces a "successful" build that never renders. Own config
  (`playwright.packaged.config.ts`, longer timeouts) so `test:e2e` never needs a package.

When adding logic, keep the testable core pure and put the I/O at the edges — follow the
existing pattern (e.g. `notifications/queueDrain.ts` pure, `notificationService.ts` does
the DB reads and the copy, `notificationDelivery.ts` does the insert/toast/IPC).

Both Playwright suites launch through `tests/support/electronEnv.ts`, which strips
`ELECTRON_RUN_AS_NODE` from the inherited environment — otherwise Electron runs as plain
Node and no window appears.

## CI (`.github/workflows/ci.yml`)

On push to `main` and PRs, two jobs run in parallel:

- **verify** — matrix over ubuntu / windows / macos:
  typecheck → lint → unit tests → database tests → build → e2e (under `xvfb-run` on
  Linux; the database tests need no display, Electron opens no window in that mode).
- **package** — matrix over `windows-latest` / `macos-latest`: `npm run test:packaged`,
  i.e. `electron-builder --dir` plus the packaged smoke test, so a packaging-config
  regression fails a push instead of waiting for someone to run `npm run dist` by hand.
  Electron and electron-builder downloads are cached on `package-lock.json`. Pushes to
  `main` also upload `release/win-unpacked` as an artifact (Windows only, 7-day retention;
  skipped on PRs, where it'd be ~250 MB per run for no added signal).

Those are the two platforms that ship builds. Linux's AppImage target is configured but
not published, so it stays out of the packaging job — packaging runs are slow. The macOS
leg doubles as a signing check: an arm64 app whose ad-hoc signature failed would not
launch, so the smoke test would catch it.

## Releasing (`.github/workflows/release.yml`)

Pushing a `v*` tag runs two stages:

1. **build** — `windows-latest` and `macos-latest` in parallel: typecheck → lint → unit
   tests → `electron-builder --publish never`, then each uploads what it made (the NSIS
   installer, both DMGs, and the `latest*.yml` feed files) as a *workflow* artifact.
   `if-no-files-found: error`, so a leg that built nothing fails instead of passing.
2. **publish** — one job, after both: downloads every artifact, checks the expected
   filenames are all present, and creates a single **draft** GitHub release with `gh`,
   then re-reads the release and fails if anything did not attach.

Write the notes on that draft, then publish it.

**Why not `electron-builder --publish always` per platform.** That is what v0.3.0 tried,
and it shipped with no DMGs. Two builders publishing into one release race to create it;
worse, `getOrCreateRelease` in `electron-publish` returns null whenever the release it
finds doesn't match the configured `releaseType` (an already-published release when
`releaseType: draft`), after which every upload logs `skipped publishing` — **and the
build still exits 0**. Building and publishing in separate stages gives one writer and
one release, and the two verification steps turn a skipped upload into a red run.

`publish.releaseType: draft` in `electron-builder.yml` is now only advisory (nothing calls
electron-builder's publisher), but it stays as the record of intent; the `gh release
create --draft` above is what actually makes the release a draft.

```
# 1. bump "version" in package.json, commit
# 2. tag and push
git tag v0.3.0 && git push origin v0.3.0
# 3. write the notes on the draft release GitHub Actions created, then publish
```

The tag must equal `package.json`'s version — the workflow fails the run if it doesn't.
Both feed the in-app update check: `APP_VERSION` is read from `package.json`
(`src/main/config.ts`), and the check compares it against the tag of the repository's
latest release. A tag that disagreed with the shipped version would notify the wrong
people, or nobody.

Draft and prerelease releases are invisible to both the check and the updater — so a build
can be uploaded and tested before anyone is told about it, and tagging a beta never prompts
a reinstall. **A draft release updates nobody**: publishing it is the step that ships.

### Updating (`services/updateService.ts`, `services/autoUpdate.ts`)

`updateService.ts` owns the *answer* — the `app_settings` cache, the daily interval, the
dismissal, and the `UpdateStatus` the renderer reads. `autoUpdate.ts` owns the
*mechanism*: it wraps `electron-updater` and does the checking, downloading and
installing. The dependency runs one way (service → updater) and a change callback carries
progress back, so the updater never needs to know what an `UpdateStatus` is.

Nothing happens unasked. `autoDownload` is off, so a check only raises the banner;
**Download** fetches the installer, **Restart to install** applies it. That is deliberate
for a tool holding an open SQLite profile and a background sync sweep — the user picks the
moment. `autoInstallOnAppQuit` is left on, so an update someone downloaded and then
ignored still lands the next time MCO quits — unless automatic updates are off, which
stands it down too (`setAutoInstallOnQuit`), because that is the one thing here that
happens at a moment nobody chose.

**Whether MCO checks at all is the user's answer**, kept in `app_settings` under
`update.autoCheck` and reported as `UpdateStatus.autoCheck`:

| Value | Means | Automatic check |
| --- | --- | --- |
| `unset` | This profile has never been asked | No — and nothing has gone to GitHub yet |
| `on` | Yes | Daily, as below |
| `off` | No | No, and no banner: Settings is where updates live now |
| `unavailable` | The build never checks anyway (`MCO_UPDATE_CHECK`, or unpackaged) | No |

`unset` is answered **once, from the update banner**, which offers the choice instead of a
release on a profile that has never been asked. A banner rather than a modal at startup:
it is the same one line in the same place as everything else the updater says, a first
launch has more urgent things on screen, and it can be answered whenever. Settings →
About holds the same switch afterwards, so nobody is stuck with the answer they gave.
Turning it on checks immediately — a yes that left the banner blank until tomorrow would
read as a broken button.

`initUpdates` backfills `on` for a profile that already has a cached check, so upgrading
does not interrupt someone to ask about the status quo. Only a genuinely new profile is
asked. Note that a dev build reads `unavailable` and shows neither prompt nor toggle —
`MCO_UPDATE_CHECK=1` is how you exercise them.

An `off` profile is not cut off from updates: Settings → "Check for updates" still asks
GitHub and still answers, with the release link. What `off` buys is that MCO never brings
it up on its own.

Two check paths, one shape. A packaged build asks the updater, so what it learns about is
by definition something it can install; anything else falls back to GitHub's
`/releases/latest` REST API (`update/github.ts`), which is what `MCO_UPDATE_CHECK=1`
exercises in dev. `update/mapUpdateInfo.ts` normalizes the updater's bare `0.2.1` to the
`v0.2.1` the REST path caches, so `app_settings` never records which one ran. The REST
path is cached and refreshed at most daily because it is unauthenticated and GitHub allows
60 API requests an hour per IP. Only packaged builds check on their own — see
`MCO_UPDATE_CHECK` above — and only where the user said yes, while Settings → "Check for
updates" always asks now. A failed
check keeps the last known answer and explains itself; it never blocks a page load.

Detection is renderer-driven (the banner mounting, the Settings button): `initUpdates` at
startup configures and subscribes but does not check. A tray-only `--background` launch
therefore never prompts, which is what it did before too — and never raises the consent
question either, since that is the banner's to ask when a window exists.

**Updates are unsigned.** The download still comes over HTTPS from GitHub and is verified
against the SHA-512 in `latest.yml`; what is missing is the Windows Authenticode check,
which electron-updater skips — with a log line saying so — on an unsigned app. The
SmartScreen warning is therefore paid once, on the first manual install, and never again.
Adding a certificate later is config plus CI secrets (`azureSignOptions`, or
`win.certificateFile` / a `sign` hook) and no application code; set `win.publisherName` at
the same time so the signature check verifies instead of skipping.

**macOS never installs in place.** `isUpdaterAvailable()` returns false on darwin, so
`canInstall` is false there and the banner offers "View release" and nothing else. Two
reasons, either of which is enough: Squirrel.Mac only applies an update whose code
signature matches the running app's, and MCO's mac builds are ad-hoc signed (see
Packaging below); and the mac target is DMG-only, while the mac updater reads a ZIP. The
*check* still runs — over the REST path, since `fetchLatest` falls back to it whenever the
updater is unavailable — so a mac user learns about a release, then downloads it by hand.
A Developer ID certificate would make both problems fixable: sign, notarize, add `zip` to
`mac.target`, and drop the darwin guard.

## Packaging (`electron-builder.yml`)

- Targets: NSIS (Windows), DMG for x64 **and** arm64 (macOS), AppImage (Linux); output in
  `release/`. Both DMGs build on one arm64 runner — electron-builder rebuilds
  better-sqlite3 per architecture — and `dmg.artifactName` keeps the arch suffix on both,
  which electron-builder would otherwise drop for the default arch.
- `mac.identity: '-'` — an **ad-hoc** signature. MCO has no Developer ID, and signing is
  not optional on Apple silicon: macOS refuses to run an unsigned arm64 binary at all.
  `identity: null` would skip signing entirely and produce an app that cannot launch, so
  the ad-hoc identity is pinned rather than left to electron-builder's fallback. Ad-hoc
  is not notarized, so a *downloaded* build is quarantined and its first launch reports
  "MCO is damaged" until the user runs `xattr -c /Applications/MCO.app` (the README says
  so). `notarize: false` and `CSC_IDENTITY_AUTO_DISCOVERY=false` in CI keep the build from
  looking for credentials that don't exist.
- `asarUnpack` for better-sqlite3 — the native `.node` binary can't load from inside
  the asar archive.
- `build/installer.nsh` adds an "MCO Background Sync" Start-menu shortcut that launches
  `MCO.exe --background` (tray-only sync). The uninstaller removes it.
- `app.setAppUserModelId` in `src/main/index.ts` must match `appId`
  (`com.anemone221.mco`) for Windows toasts to work under NSIS — **and a Start-menu
  shortcut must declare that same AUMID**, since Windows reads a toast's icon and display
  name off it. electron-builder does that for its own shortcuts; `installer.nsh` does it
  for the Background Sync one via `WinShell::SetLnkAUMI`. Verify on an installed build
  with `Get-StartApps | ? Name -match MCO` — an `AppID` of `Microsoft.AutoGenerated.{…}`
  instead of `com.anemone221.mco` means the AUMID did not stick and toasts will show a
  generic icon.
- `resources/tray.png` is the tray icon, imported with electron-vite's `?asset` suffix.

### Windows packaging: `winCodeSign` symlink error

On Windows, `npm run dist` may fail while unpacking electron-builder's toolchain:

```
⨯ cannot execute … 7za.exe x … winCodeSign-2.6.0.7z …
  ERROR: Cannot create symbolic link : A required privilege is not held by the
  client. : …\winCodeSign\…\darwin\10.12\lib\libssl.dylib
```

The `winCodeSign` bundle (used for `rcedit`, which stamps the app icon/version onto
`MCO.exe`) contains **macOS `.dylib` symlinks**, and Windows forbids creating symlinks
without elevation. The `darwin/*` files are never used on Windows. Any one of these fixes
it — pick the first that applies:

1. **Enable Developer Mode** (Settings → System → For developers → Developer Mode = On),
   then `npm run dist`. Grants symlink privilege to normal user shells; persists.
2. **Run the build once from an Administrator terminal.** The toolchain extracts and
   caches, after which normal (non-admin) builds work.
3. **Pre-seed the cache without the symlinks** (no admin needed), then build:
   ```sh
   CACHE="$LOCALAPPDATA/electron-builder/Cache/winCodeSign"   # %LOCALAPPDATA%\electron-builder\Cache\winCodeSign
   node_modules/7zip-bin/win/x64/7za.exe x "$CACHE"/*.7z -o"$CACHE/winCodeSign-2.6.0" -xr'!'darwin -y
   npm run dist
   ```
   app-builder finds the extracted `winCodeSign-2.6.0` folder and skips its own (failing)
   extraction. The cache persists, so this is a one-time step per machine.

CI (GitHub-hosted Windows runners) is unaffected — those images allow symlink creation.

### App icons

The app icon derives from `Clonebay_1024.png` (repo root, the 1024×1024 master; the
smaller `Clonebay_256/128.png` and the original 64px `Clonebay.png` are kept as
convenience copies).

> **Provenance:** `Clonebay.png` is EVE Online's in-game clone bay station-service icon,
> copied unmodified; the larger masters are upscales of it, and **every icon below —
> window, exe, installer and tray — derives from it.** It is CCP hf.'s artwork, used under
> the EVE Developer License Agreement — not ours, and not covered by this repo's MIT
> license. The DLA licenses game icons for non-commercial use *within* an application, and
> an upscale is a derivative work that belongs to CCP — so MCO does not own its brand
> mark, and this is the one asset that would have to change if CCP objected. Redrawing an
> original icon would remove both concerns; keep that in mind before reusing it anywhere.

Generated assets:

- `build/icon.ico` — multi-resolution Windows icon (16/24/32/48/64/128/256, each a PNG
  frame downscaled from the 1024 master), referenced by `win.icon` in
  `electron-builder.yml`. Embedded in `MCO.exe` and the NSIS installer.
- `build/icon.png` — 1024×1024; a direct copy of the master. electron-builder generates
  the macOS `.icns` and Linux icon set from it (auto-discovered in `buildResources: build`).
- `resources/icon.png` — 256×256 (copy of `Clonebay_256.png`); the runtime `BrowserWindow`
  icon (dev + Linux window / taskbar), imported via `?asset` in `src/main/index.ts`.
  Windows/macOS packaged builds use the embedded exe/bundle icon instead.
- `resources/tray.png` (32×32) + `resources/tray@2x.png` (64×64) — the notification-area
  icon for background mode, loaded in `src/main/tray.ts`. `nativeImage` picks the `@2x`
  rep on HiDPI displays. **These are separate from the window/exe icon** — a new master
  is not picked up here unless they are regenerated too.

To regenerate after replacing the master (keep it **1024×1024** for crisp downscales),
copy the master to `build/icon.png` + a 256 to `resources/icon.png`, downscale the tray
pair, then rebuild the `.ico` by downscaling the master to each size. With ImageMagick:

```
cp Clonebay_1024.png build/icon.png
magick Clonebay_1024.png -resize 256x256 resources/icon.png
magick Clonebay_1024.png -resize 32x32 resources/tray.png
magick Clonebay_1024.png -resize 64x64 'resources/tray@2x.png'
magick Clonebay_1024.png -define icon:auto-resize=256,128,64,48,32,24,16 build/icon.ico
```

## Conventions

- Prettier (`.prettierrc.json`) + eslint are the source of truth for style; run
  `npm run format` before committing.
- **Charts**: `@amcharts/amcharts5` (devDependency, bundled into the renderer;
  free tier — the small amCharts logo on each chart is the license condition).
  Import subpaths only (`@amcharts/amcharts5`, `.../xy`, `.../hierarchy`,
  `.../radar`, `.../themes/Animated`) so the bundle carries just the modules in use. Every
  chart goes through `components/charts/useAmChart.ts`, which owns root
  lifecycle (`am5.Root.new` in `useLayoutEffect`, `root.dispose()` on unmount),
  theme-palette colors, and ISK number abbreviations. Follow the amCharts5
  skill rules (github.com/amcharts/amcharts5-skill): factory `.new()` only,
  `am5.color(...)` for colors, set data last. For single-level packed circles,
  `Pack` (deterministic, fits the container) beats `ForceDirected` (physics —
  inconsistent sizes, off-screen nodes); wrap the nodes under one hidden root
  and reach the real per-node circles via `dataItems[0].get('children')`, not
  the flat `series.dataItems`. Charts that render **character portraits**
  (e.g. `CharacterSpChart`) must be demo-safe: gate the image URL on
  `isDemoMode()` and fall back to a plain fill, so real portraits never leak
  (mirrors `CharacterAvatar`). The CSP needs no changes (canvas rendering,
  portraits are `img-src`-allowed from `images.evetech.net`).
- **Motion**: durations/easings come from the `--anim-*` custom properties in
  `styles.css`; JS-driven animation checks `prefersReducedMotion()`
  (`renderer/lib/motion.ts`). Both honor the OS reduced-motion setting.
- snake_case in SQL, camelCase in TypeScript; repositories translate at the boundary.
- IPC additions touch exactly four files — see
  [architecture.md](architecture.md#ipc-pattern).
- Schema changes are append-only migrations — see [database.md](database.md#migrations-srcmaindbmigrationsts).
- UI: density-first, EVE-matching status colors, "—" for absent values — see
  [CLAUDE.md](../CLAUDE.md#ui-conventions).
