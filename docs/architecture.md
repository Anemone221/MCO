# Architecture

MCO is an Electron app with the standard three-process split, built by
[electron-vite](https://electron-vite.org/) (config: `electron.vite.config.ts`).

```
┌────────────────────────── main process ──────────────────────────┐
│  index.ts        window/tray lifecycle, single-instance lock     │
│  ipc/           channels/ per domain → service/repository call   │
│  services/       view-model assembly (roster, boards, analysis)  │
│  esi/            HTTP client, rate limiter, endpoint wrappers    │
│  auth/           SSO PKCE login, token store, scope status       │
│  sde/            SDE download + streaming YAML import            │
│  fits/ plans/    pure parsers + analysis math (no I/O)           │
│  notifications/  pure queue-drain detection                      │
│  sync/           pure character sync-state classification        │
│  update/         pure semver compare + release parsing/mapping   │
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
│  components/  SdeBanner, UpdateBanner, NotificationBell, …       │
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
2. `src/preload/index.ts` — bridge the method through the local `invoke` helper.
3. `src/main/ipc/channels/<domain>.ts` — `handle(...)` wiring to a service/repository, in
   the module for that domain (a new domain is a new module plus one line in
   `register.ts`).
4. The renderer page/component that calls `mco.<domain>.<method>()`.

Miss step 3 and `registerIpc` says so at startup: it compares the channels `handle()`
actually wired against every declared channel bar the push-only ones
(`ipc/coverage.ts` + `IPC_EVENT_CHANNELS`), and throws unpackaged (dev, E2E) rather than
letting one page fail later with "No handler registered". A packaged build logs it
instead — one broken page beats refusing to start.

Request/response uses `invoke`/`handle`. Main→renderer push uses `webContents.send` on
two event channels, each with an `onChanged`-style subscription in the API:
`characters:changed` (background sync finished a sweep) and `notifications:changed`
(new notification recorded). `sde:progress` streams import progress the same way.

### Loading data in a page

Step 4 above is one hook, not a hand-rolled state machine. **`useMcoData`**
(`src/renderer/src/lib/useMcoData.ts`) runs a loader on mount, again when its `deps`
change (a route param), and — with `onCharactersChanged: true` — whenever a background
sync sweep lands, returning `{ data, error, loading, reload, setData, setError }`:

```ts
const { data, error, loading, reload } = useMcoData(
  () => mco.dashboard.summary(),
  { onCharactersChanged: true },
);
```

`data` is `null` until the first load resolves; a page fetching several sources returns an
object and destructures with defaults (`const { roster = [], tags = [] } = data ?? {};`).
The hook owns `errorMessage()`, clears the error at the start of every run, keeps the last
good data on failure, and discards a run that a newer one has superseded — so a sweep
firing mid-load, StrictMode's double mount, and a fast route change cannot land stale
data. `load` is read from a ref, so it needs no `useCallback`.

The two components that stream rather than fetch — `NotificationBell` (its own
`notifications:changed` subscription) and `SdeBanner` (`sde:progress`) — stay outside it.

Its sibling **`useDebouncedSearch`** (`src/renderer/src/lib/useDebouncedSearch.ts`) is the
type-ahead equivalent: it debounces a query, runs a `search` channel, and drops answers the
query has moved past. `HomeStationPicker` and `PodSystemPicker` are each just markup over
it.

### Error boundary

A rejected `invoke` is rendered by whichever page made the call, so an unguarded throw
puts a developer-facing message on screen. Every request/response call passes through a
wrapper on each side of the bridge — use them; neither `ipcMain.handle` nor
`ipcRenderer.invoke` should be called directly outside those two helpers.

- **`handle()` in `src/main/ipc/handle.ts`** logs the real error with its channel
  (`[ipc] tags:create failed: …`, captured for Settings → Export logs) and rethrows what
  `toUserMessage` decides the renderer may see.
- **`toUserMessage` in `src/main/errors.ts`** passes a **`UserFacingError`** through
  verbatim, maps a `SQLITE_CONSTRAINT_UNIQUE` failure to "That name is already in use.",
  and replaces everything else with a generic line. Plain `Error` stays the default, so a
  message reaches the UI only when someone chose to write it for a user — throw
  `UserFacingError` for the failures a user can act on (bad EFT paste, missing ESI scope).
- **`invoke()` in `src/preload/index.ts`** strips the `Error invoking remote method
  '<channel>': Error:` plumbing Electron wraps a rejection in, via
  `cleanIpcErrorMessage` (`src/shared/ipcError.ts`).
- **`errorMessage()` in `src/renderer/src/lib/ipc.ts`** is what a page's `catch` calls —
  never `String(e)`, which re-prepends `Error: ` to a finished sentence.

Net effect: `Unknown character 123` and `SqliteError: UNIQUE constraint failed: tags.name`
stay in the log, while the UI shows a sentence. Covered by `tests/unit/ipcErrors.test.ts`
and two E2E cases in `tests/e2e/app.spec.ts`.

### Crash handling (`src/main/fatal.ts`)

The error boundary above covers a throw *inside an IPC handler*. A throw outside one — in
a timer, an event handler, the scheduler — is an uncaught exception, which ends the main
process and takes the window with it. The catch is that Settings → Export logs, the only
way to reach this session's log, dies with it: a crash would otherwise be a silent
disappearance with nothing left to look at.

`initFatalErrorHandler()` (installed in `index.ts` immediately after `initLogCapture()`,
so there is a buffer to write) logs the error, writes
`mco-crash-<stamp>.txt` **next to the profile database**, then shows a dialog naming that
file and exits. Order matters: logging first puts the crash's own stack inside the report,
and the write is synchronous because an async write queued behind a dying event loop may
never reach the disk. A re-entrancy flag keeps a failure *while reporting* from looping.

The report body is `buildDiagnosticsText()` from `settingsService.ts` — the same content
Export logs writes. Every field in its header that touches the database or filesystem is
read through `safely()`, since the crash being reported may well be the thing the header
wants to read, and a header that throws would replace the diagnostic with a second crash.

Unhandled promise *rejections* are deliberately not fatal: `log.ts` logs them (through the
patched console, so they are visible live in a dev terminal, not just in an export) and
the process carries on. Registering that listener is also what keeps them non-fatal —
Node's default since v15 is to rethrow, which this handler would then treat as a crash.
With ~90 characters syncing, one rejected background promise must not close the app.

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
  `auth/scopeStatus.ts`, `sync/characterSyncState.ts`, `update/version.ts`,
  `update/github.ts`, `launchMode.ts`, and the
  view-model half of `renderer/src/lib/` (`rosterView`, `groupView`, `blueprintView`,
  `costView`, `format`, `groups`, `tags`, `theme`, `motion`, `demo`). The bridge modules
  there — `ipc.ts` and the `useMcoData` hook it backs — need `window.mco` and a React
  renderer, so they are covered by E2E instead.

Path aliases: `@main`, `@shared`, `@renderer` (see `electron.vite.config.ts`).

## Launch modes & lifecycle (`src/main/index.ts`)

Two ways to launch, distinguished by the `--background` flag (`launchMode.ts`):

- **Normal**: opens the main window (1400×900, dark `#0d1117`).
- **Background** (`npm run start:background`, or the "MCO Background Sync" Start-menu
  shortcut created by `build/installer.nsh`): no window — just a tray icon (`tray.ts`)
  with *Open MCO / Run sync now / Quit*, while the scheduler keeps syncing.

The scheduler runs in **both** modes — the flag only decides whether a window and a tray
icon exist at startup. Which is why tray residency is a *runtime* choice too, owned by
`services/backgroundMode.ts`:

- **Settings → Background sync → "Keep syncing in the tray when I close the window"**
  persists `close_to_tray` in `app_settings` and raises the tray immediately.
- **"Run in background now"** raises the tray and closes the window in one step.

`window-all-closed` then asks `shouldQuitOnWindowClose({ platform, residentInTray })`
(pure, unit-tested) instead of reading the launch flag. Resident = launched with
`--background`, or the preference is on, or "Run in background now" was used this session.
The first close into the tray raises a one-time "MCO is still running" toast, because a
process that leaves the taskbar but keeps running otherwise reads as a crash.

Runtime residency additionally requires the tray icon to have actually come up
(`ensureTray` catches — some Linux desktops have no notification area): with no tray and
no window there would be no way back into the app and no way to quit it. For the same
reason a `--background` launch that cannot raise a tray falls back to opening a window.

A **single-instance lock** guards both modes. This is not cosmetic: EVE SSO rotates the
refresh token on every refresh, so two MCO processes racing to refresh the same character
would invalidate the token family and de-auth the character. A second normal launch
*promotes* the running instance (shows/creates the window); a second background launch is
a no-op. Closing a promoted window in background mode drops back to tray-only sync.

Startup order: open DB (runs migrations) → `initBackgroundMode` (reads the preference, so
it must follow the DB open) → `registerIpc` → `startScheduler` → `initUpdates` → window or
tray. On quit: destroy tray, stop scheduler, close DB.

`initUpdates` (`services/updateService.ts`) configures `electron-updater` and subscribes
to it; it does not check. Detection stays renderer-driven — the banner mounting, Settings
→ "Check for updates" — so a tray-only launch with no window never prompts. Whether the
automatic check runs at all is a per-profile preference (`update.autoCheck`) that a new
profile has not answered yet; the banner asks once, before any release traffic. See
`docs/development.md` § Updating.

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
