# Development

## Prerequisites

- Node.js ≥ 20.19 (CI uses 22)
- `npm ci` (postinstall runs `electron-builder install-app-deps` to rebuild
  better-sqlite3's native binary against Electron)

## npm scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | electron-vite dev server with hot reload |
| `npm run build` | Build main/preload/renderer into `out/` |
| `npm run start` / `preview` | Run the built app |
| `npm run start:background` | Run the built app tray-only (background sync mode) |
| `npm run typecheck` | `tsconfig.node.json` (main+preload) then `tsconfig.web.json` (renderer) |
| `npm run lint` | eslint (flat config, `eslint.config.mjs`) |
| `npm run format` | prettier --write |
| `npm run test:unit` / `test:unit:watch` | vitest |
| `npm run test:e2e` | `electron-vite build` then Playwright against the built app |
| `npm run test:packaged` | `dist:dir` then Playwright against the **packaged** binary |
| `npm run dist` | Build + electron-builder installer into `release/` |
| `npm run dist:dir` | Same but unpacked directory (fast, for smoke-testing packaging) |

## Environment variables

| Variable | Effect |
| --- | --- |
| `MCO_ESI_CLIENT_ID` | Override the committed EVE developer app client_id (`src/main/config.ts`). |
| `MCO_SDE_URL` | Override the pinned SDE zip URL. |
| `MCO_UPDATE_CHECK` | `1` enables the GitHub release check in a dev build, `0` disables it in a packaged one. Default: packaged builds only. |
| `ELECTRON_RENDERER_URL` | Set by electron-vite dev — main loads the dev server instead of the built `index.html`. |

To use your own EVE application: register at https://developers.eveonline.com/ with
callback URL `http://localhost:8765/callback` and the scopes listed in `ESI_SCOPES`
(`src/main/config.ts`). The client_id is not a secret under PKCE.

## Testing strategy

Three layers, deliberately:

- **Unit (vitest, `tests/unit/`)** — pure logic only, no Electron/DB/network. This is
  why parsers, analysis math, filtering/sorting, scope classification, and queue-drain
  detection live in dependency-free modules. Current suites: `eft`, `fitAnalyze`,
  `skillPlanParse`, `planAnalyze`, `sdeParse`, `rateLimiter`, `pkce`, `scopeStatus`,
  `queueDrain`, `launchMode`, `format`, `rosterView`, `groups`, `tags`, `updateCheck`,
  `routing`, `nearestView`.
  - `tests/unit/renderer/` is the one exception: tests whose subject touches **DOM
    globals** (`window`, and the `lib/ipc.ts` demo wrapper hanging off it). Everything
    under `tests/` is type-checked by `tsconfig.node.json`, which has no DOM lib, so
    that directory is excluded there and included by `tsconfig.web.json` instead.
    vitest runs both the same way. Put a test here only when it needs the DOM types —
    pure logic stays in `tests/unit/`.
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
  typecheck → lint → unit tests → build → e2e (under `xvfb-run` on Linux).
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
ignored still lands the next time MCO quits.

Two check paths, one shape. A packaged build asks the updater, so what it learns about is
by definition something it can install; anything else falls back to GitHub's
`/releases/latest` REST API (`update/github.ts`), which is what `MCO_UPDATE_CHECK=1`
exercises in dev. `update/mapUpdateInfo.ts` normalizes the updater's bare `0.2.1` to the
`v0.2.1` the REST path caches, so `app_settings` never records which one ran. The REST
path is cached and refreshed at most daily because it is unauthenticated and GitHub allows
60 API requests an hour per IP. Only packaged builds check on their own — see
`MCO_UPDATE_CHECK` above — while Settings → "Check for updates" always asks now. A failed
check keeps the last known answer and explains itself; it never blocks a page load.

Detection is renderer-driven (the banner mounting, the Settings button): `initUpdates` at
startup configures and subscribes but does not check. A tray-only `--background` launch
therefore never prompts, which is what it did before too.

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
> license. See A5 in [improvement-plan.md](improvement-plan.md) before reusing it
> anywhere, or if you ever want a mark MCO actually owns.

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
  `.../themes/Animated`) so the bundle carries just the modules in use. Every
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
