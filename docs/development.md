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
| `npm run dist` | Build + electron-builder installer into `release/` |
| `npm run dist:dir` | Same but unpacked directory (fast, for smoke-testing packaging) |

## Environment variables

| Variable | Effect |
| --- | --- |
| `MCO_ESI_CLIENT_ID` | Override the committed EVE developer app client_id (`src/main/config.ts`). |
| `MCO_SDE_URL` | Override the pinned SDE zip URL. |
| `ELECTRON_RENDERER_URL` | Set by electron-vite dev — main loads the dev server instead of the built `index.html`. |

To use your own EVE application: register at https://developers.eveonline.com/ with
callback URL `http://localhost:8765/callback` and the scopes listed in `ESI_SCOPES`
(`src/main/config.ts`). The client_id is not a secret under PKCE.

## Testing strategy

Two layers, deliberately:

- **Unit (vitest, `tests/unit/`)** — pure logic only, no Electron/DB/network. This is
  why parsers, analysis math, filtering/sorting, scope classification, and queue-drain
  detection live in dependency-free modules. Current suites: `eft`, `fitAnalyze`,
  `skillPlanParse`, `planAnalyze`, `sdeParse`, `rateLimiter`, `pkce`, `scopeStatus`,
  `queueDrain`, `launchMode`, `format`, `rosterView`, `groups`, `tags`.
- **E2E (Playwright, `tests/e2e/app.spec.ts`)** — launches the **built** app
  (`out/main/index.js`) via Playwright's `_electron` against a throwaway temp
  `userData` dir per test, so tests are hermetic and don't touch your real profile.
  Covers: launch/empty states, account/group/tag persistence across restarts, fit and
  plan import, page navigation, notification bell. Config: `playwright.config.ts`
  (sequential, 1 worker — Electron apps don't parallelize well).

When adding logic, keep the testable core pure and put the I/O at the edges — follow the
existing pattern (e.g. `notifications/queueDrain.ts` pure + `notificationService.ts`
does DB/toast/IPC).

E2E note: the spec strips `ELECTRON_RUN_AS_NODE` from the inherited environment before
launching, otherwise Electron runs as plain Node and no window appears.

## CI (`.github/workflows/ci.yml`)

On push to `main` and PRs, matrix over ubuntu / windows / macos:
typecheck → lint → unit tests → build → e2e (under `xvfb-run` on Linux).

## Packaging (`electron-builder.yml`)

- Targets: NSIS (Windows), DMG (macOS), AppImage (Linux); output in `release/`.
- `asarUnpack` for better-sqlite3 — the native `.node` binary can't load from inside
  the asar archive.
- `build/installer.nsh` adds an "MCO Background Sync" Start-menu shortcut that launches
  `MCO.exe --background` (tray-only sync). The uninstaller removes it.
- `app.setAppUserModelId` in `src/main/index.ts` must match `appId`
  (`com.anemone221.mco`) for Windows toasts to work under NSIS.
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
convenience copies). Generated assets:

- `build/icon.ico` — multi-resolution Windows icon (16/24/32/48/64/128/256, each a PNG
  frame downscaled from the 1024 master), referenced by `win.icon` in
  `electron-builder.yml`. Embedded in `MCO.exe` and the NSIS installer.
- `build/icon.png` — 1024×1024; a direct copy of the master. electron-builder generates
  the macOS `.icns` and Linux icon set from it (auto-discovered in `buildResources: build`).
- `resources/icon.png` — 256×256 (copy of `Clonebay_256.png`); the runtime `BrowserWindow`
  icon (dev + Linux window / taskbar), imported via `?asset` in `src/main/index.ts`.
  Windows/macOS packaged builds use the embedded exe/bundle icon instead.

To regenerate after replacing the master (keep it **1024×1024** for crisp downscales),
copy the master to `build/icon.png` + a 256 to `resources/icon.png`, then rebuild the
`.ico` by downscaling the master to each size. With ImageMagick:

```
cp Clonebay_1024.png build/icon.png
magick Clonebay_1024.png -resize 256x256 resources/icon.png
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
