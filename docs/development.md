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

### App icons

The app icon derives from `Clonebay.png` (repo root, the editable master). Generated
assets:

- `build/icon.ico` — multi-resolution Windows icon (16/24/32/48/64/128/256), referenced
  by `win.icon` in `electron-builder.yml`. Embedded in `MCO.exe` and the NSIS installer.
- `build/icon.png` — 1024×1024; electron-builder generates the macOS `.icns` and Linux
  icon set from it (auto-discovered in `buildResources: build`).
- `resources/icon.png` — 256×256; the runtime `BrowserWindow` icon (dev + Linux window /
  taskbar), imported via `?asset` in `src/main/index.ts`. Windows/macOS packaged builds
  use the embedded exe/bundle icon instead.

To regenerate after replacing the master (use a **≥512×512** source for crisp results —
64×64 upscales soft), re-run the `System.Drawing` resize used to create them, or convert
with ImageMagick:

```
magick Clonebay.png -resize 1024x1024 build/icon.png
magick Clonebay.png -resize 256x256   resources/icon.png
magick Clonebay.png -define icon:auto-resize=256,128,64,48,32,24,16 build/icon.ico
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
