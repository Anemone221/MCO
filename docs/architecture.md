# Architecture

MCO is an Electron app with the standard three-process split, built by
[electron-vite](https://electron-vite.org/) (config: `electron.vite.config.ts`).

```
┌────────────────────────── main process ──────────────────────────┐
│  index.ts        window/tray lifecycle, single-instance lock     │
│  ipc/register.ts every IPC channel → service/repository call     │
│  services/       view-model assembly (roster, boards, analysis)  │
│  esi/            HTTP client, rate limiter, endpoint wrappers    │
│  auth/           SSO PKCE login, token store, scope status       │
│  sde/            SDE download + streaming YAML import            │
│  fits/ plans/    pure parsers + analysis math (no I/O)           │
│  notifications/  pure queue-drain detection                      │
│  sync/           pure character sync-state classification        │
│  wallet/         pure current-month income windowing             │
│  db/             better-sqlite3 handle, migrations, repositories │
│  log.ts          console capture for the Settings log export     │
└───────────────▲──────────────────────────────────────────────────┘
                │ ipcMain.handle / webContents.send
┌───────────────┴───────────┐
│  preload/index.ts         │  contextBridge → window.mco (typed McoApi)
└───────────────▲───────────┘
                │ window.mco.*
┌───────────────┴──────────────────────────────────────────────────┐
│  renderer (React 19 + react-router, sandboxed, no Node)          │
│  App.tsx      sidebar nav + routes                               │
│  pages/       Dashboard, Roster, CharacterDetail, Accounts,      │
│               Groups, Tags, Location, Fits(+Detail),             │
│               Plans(+Detail), Clones, Wallet, Settings           │
│  components/  SdeBanner, NotificationBell, TagSelect, …          │
│  lib/         pure view logic (filter/sort/format) — unit-tested │
│  theme.ts     applies/persists the theme (DOM side of lib/theme) │
└──────────────────────────────────────────────────────────────────┘
```

## IPC pattern

The renderer runs with `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`
(`src/main/index.ts`). Its **only** door to the outside world is `window.mco`, exposed by
`src/preload/index.ts` via `contextBridge`.

The contract lives in `src/shared/ipc.ts`:

- `IpcChannel` — a const map of every channel name (`'characters:roster'`, `'tags:create'`, …).
- `McoApi` — the typed shape of `window.mco`, grouped by domain
  (`characters`, `accounts`, `groups`, `tags`, `sde`, `fits`, `plans`, `location`,
  `clones`, `notifications`, `system`, `settings`).

**Adding a new IPC capability touches exactly four files:**

1. `src/shared/ipc.ts` — add the channel name and the `McoApi` method signature
   (+ any new types in `src/shared/types.ts`).
2. `src/preload/index.ts` — bridge the method to `ipcRenderer.invoke`.
3. `src/main/ipc/register.ts` — `ipcMain.handle(...)` wiring to a service/repository.
4. The renderer page/component that calls `mco.<domain>.<method>()`.

Request/response uses `invoke`/`handle`. Main→renderer push uses `webContents.send` on
two event channels, each with an `onChanged`-style subscription in the API:
`characters:changed` (background sync finished a sweep) and `notifications:changed`
(new notification recorded). `sde:progress` streams import progress the same way.

## Layering rules

- **Repositories** (`src/main/db/repositories/*`) are the only modules that write SQL.
  One file per aggregate: `characters`, `accounts`, `groups`, `tags`, `tokens`, `skills`,
  `esiCache`, `fits`, `plans`, `notifications`, `clones`, `characterLocation`,
  `characterFatigue`, `sde`.
- **Services** (`src/main/services/*`) compose repositories + ESI + SDE lookups into the
  view models the renderer consumes (`buildRoster`, `buildLocationBoard`,
  `buildCloneBoard`, `buildCharacterDetail`, `analyzeFitById`, `analyzePlanById`,
  `runSdeImport`, sync + scheduler + notifications).
- **Pure logic modules** have no Electron/DB/network imports so vitest can hit them
  directly: `fits/eft.ts` (EFT parser), `fits/analyze.ts` (SP math + prerequisite
  closure), `plans/parse.ts`, `notifications/queueDrain.ts`, `auth/pkce.ts`,
  `auth/scopeStatus.ts`, `sync/characterSyncState.ts`, `launchMode.ts`, and all of
  `renderer/src/lib/`.

Path aliases: `@main`, `@shared`, `@renderer` (see `electron.vite.config.ts`).

## Launch modes & lifecycle (`src/main/index.ts`)

Two ways to launch, distinguished by the `--background` flag (`launchMode.ts`):

- **Normal**: opens the main window (1400×900, dark `#0d1117`).
- **Background** (`npm run start:background`, or the "MCO Background Sync" Start-menu
  shortcut created by `build/installer.nsh`): no window — just a tray icon (`tray.ts`)
  with *Open MCO / Run sync now / Quit*, while the scheduler keeps syncing.

A **single-instance lock** guards both modes. This is not cosmetic: EVE SSO rotates the
refresh token on every refresh, so two MCO processes racing to refresh the same character
would invalidate the token family and de-auth the character. A second normal launch
*promotes* the running instance (shows/creates the window); a second background launch is
a no-op. Closing a promoted window in background mode drops back to tray-only sync.

Startup order: open DB (runs migrations) → `registerIpc` → `startScheduler` → window or
tray. On quit: destroy tray, stop scheduler, close DB.

`app.setAppUserModelId('com.anemone221.mco')` is required for Windows toast notifications
under the NSIS build target (which, unlike Squirrel, does not auto-register the AUMID).

## Background sync (`services/scheduler.ts`)

- First sweep 15 s after startup (so it doesn't compete with app launch), then hourly.
- A sweep calls `syncDueCharacters()`: a character is **due** when its cached ESI
  `/skills/` response has expired — ESI's own `Expires` header drives the cadence, not a
  fixed clock (see [esi.md](esi.md)).
- Each character syncs independently (`Promise.allSettled`); one failure never aborts the
  sweep.
- After the sweep, `checkQueueDrainWarnings` scans stored skill queues and raises
  notifications (see [features.md](features.md#notifications)).
- The sweep ends by pushing `characters:changed` so an open window refreshes.

## What syncs where

| Data | Written by | Read from |
| --- | --- | --- |
| Public info, skills, skill queue | every sync (required) | DB |
| Location + current ship | every sync (best-effort) | DB (Roster/Location); live ESI on CharacterDetail |
| Active implants, jump clones | sync, only if scope granted (best-effort) | DB |
| Jump fatigue | sync, only if scope granted (best-effort) | DB |
| NPC station names | on demand (public ESI, cached) | esi_cache |

"Best-effort" = wrapped in try/catch; a failure logs a warning and the sync still counts
as successful. Scope-gated calls are skipped entirely when the token lacks the scope
(`hasGrantedScope`) instead of burning ESI error budget on guaranteed 403s.

## Storage locations (Electron `userData` dir)

- `mco.sqlite` — everything (characters, tokens, skills, SDE, caches, notifications).
- `sde-cache/sde.zip` — the downloaded SDE archive.
