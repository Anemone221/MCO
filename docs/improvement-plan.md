# MCO Improvement Plan

Prioritized, based on a full review of the working tree (2026-07-26). The codebase is in
strong shape — strict TypeScript with **zero `any` / zero suppressions**, clean typecheck,
262 passing unit tests, a well-layered architecture, and a genuinely sophisticated ESI
client. This plan is about the last mile to shippable `.exe`s and hardening, not rescue
work.

Legend: **P0** = blocks a professional release · **P1** = should land before/with first
public build · **P2** = quality/robustness · **P3** = nice-to-have.

---

## A. Release readiness — generating `.exe`s

### A1 · App icon (P0) — ✅ done
Was: no application icon (default Electron icon on exe/installer/window). Now wired from
the crisp `Clonebay_1024.png` master:

- `build/icon.ico` — multi-resolution (16/24/32/48/64/128/256, each a PNG frame
  downscaled from the 1024 master; verified all frames decode), referenced by `win.icon`
  in `electron-builder.yml`.
- `build/icon.png` — 1024×1024 (copy of the master); electron-builder generates the macOS
  `.icns` and Linux icon set from it (auto-discovered in `buildResources: build`).
- `resources/icon.png` — 256×256; the runtime `BrowserWindow` icon, imported via
  `?asset` in `src/main/index.ts` (same proven mechanism as the tray icon).

Regeneration steps are documented in [development.md](development.md) (App icons section).

### A2 · Commit the build inputs (P0) — ✅ done
Was: `build/` and `resources/` were untracked, so a fresh clone could not produce a
correct package. Landed across `d40bbff` and `9622091`; every input is now tracked and
none is matched by `.gitignore`:

- `build/` — `icon.ico`, `icon.png`, `installer.nsh`
- `resources/` — `icon.png`, `tray.png`, `tray@2x.png` (the last added in `9622091`)
- `electron-builder.yml`, `package-lock.json`, and the `Clonebay_*.png` icon masters
  needed to regenerate the icons

Verified by building the committed state, not by reading the index: `git archive HEAD`
into an empty directory → `npm ci` → `npm run test:packaged` (packages and boots the real
binary) → `npm run dist`, which produced a 96 MB `MCO Setup 0.1.0.exe`. That exercises the
two inputs `--dir` alone never touches — `build/installer.nsh` (the NSIS `customInstall`
macro) and `build/icon.ico`, confirmed stamped onto `MCO.exe` rather than the default
Electron icon.

Going forward this is guarded rather than trusted: A4's `package` job builds from a fresh
checkout on every push, and the packaged smoke test asserts the unpacked `resources/*.png`
are present — an uncommitted build input fails CI rather than the next release.

### A3 · Code signing / distribution trust (P1 — decision required)
Unsigned builds are functional but hostile to users:
- **Windows:** SmartScreen shows "Windows protected your PC / unknown publisher." An OV/EV
  code-signing certificate removes it (EV clears reputation immediately).
- **macOS:** an unsigned/un-notarized `.dmg` is Gatekeeper-blocked; users must
  right-click → Open. Real distribution needs an Apple Developer ID + notarization
  (`hardenedRuntime`, `entitlements`, `afterSign` notarize step).

Decide the target audience. If it's "me + a few corpmates," document the right-click-open
/ SmartScreen "More info → Run anyway" steps in the README and ship unsigned. If it's
public, budget for certs. Either way, make it an explicit, written decision — don't let
the first user discover it.

### A4 · CI never packages (P1) — ✅ done
Was: CI ran `build` but not `electron-builder`, so a broken packaging config (a bad
`files` glob, an `asarUnpack` regression for `better-sqlite3`, a missing icon) was only
caught by a manual `npm run dist`. Now a `package` job runs on every push:

- `.github/workflows/ci.yml` gains a **`package` job on `windows-latest`** (parallel with
  `verify`, Electron/electron-builder downloads cached on `package-lock.json`) running
  `npm run test:packaged` → `electron-vite build && electron-builder --dir` plus a smoke
  test. Pushes to `main` upload `release/win-unpacked` (7-day retention; skipped on PRs).
- **`tests/packaged/smoke.spec.ts`** (own config, `playwright.packaged.config.ts`) —
  because electron-builder exiting 0 does *not* mean the package works. It asserts
  `app.asar` plus the unpacked `better_sqlite3.node` and `resources/{icon,tray,tray@2x}.png`,
  then boots the real `MCO.exe` against a temp profile and checks the Dashboard renders.
  A missing icon needs no assertion — electron-builder fails the build when `win.icon`
  points at nothing.
- `tests/support/electronEnv.ts` — the `ELECTRON_RUN_AS_NODE` strip, shared by both
  Playwright suites.

Windows only for now (primary target; packaging is slow) — see the CI section of
[development.md](development.md) for adding the macOS/Linux targets.

### A5 · EVE third-party distribution terms (P1 — non-code) — ✅ done (one item for you)
CCP's [Developer License Agreement](https://developers.eveonline.com/license-agreement) is
the governing document. Its standard third-party notice now ships in two places, worded as
CCP writes it (only the tool name is substituted — same form pyfa and zKillboard use):

- **README.md § Legal** — the full notice, plus a plain-language line that MCO is
  unofficial, non-commercial, and never sees the user's password.
- **Settings → About** — the same notice, `.legal-notice` (small, quiet, not collapsible,
  since a hidden disclaimer is not a displayed one). An E2E case asserts it renders, so it
  can't be dropped by accident.

Reviewed against the DLA's substantive requirements — MCO complies on each:

| Requirement | MCO |
| --- | --- |
| Non-commercial | Free, no monetization, no ads |
| No tracking players without consent | Reads only characters the user authenticates via SSO |
| No phishing / credential handling | SSO runs in the system browser; MCO never sees the password. Refresh tokens encrypted via `safeStorage` |
| Don't combine CCP marks with your own | Product name "MCO — Massive Character Organization" carries no CCP mark. The app icon **is** CCP artwork — see below |
| Retain CCP proprietary notices | The notice above |
| ESI citizenship | `USER_AGENT` carries version + contact + repo URL; SDE is downloaded from CCP's URL at runtime, not redistributed |

**The app icon is CCP's artwork.** `Clonebay.png` is the in-game clone bay station-service
icon, copied unmodified; the `_128/_256/_1024` masters are upscales of it, and everything
in `build/`+`resources/` derives from them. This is *permitted* — CCP's third-party
toolkit explicitly licenses the game's 32×32/64×64 type and service icons to licensed
developers for non-commercial use, and the notice MCO now displays already assigns all
artwork to CCP hf. Two consequences to be deliberate about:

- **You don't own your brand mark.** An upscale is a Derivative Work, which the DLA vests
  in CCP. The repo is MIT, but that license cannot cover this file.
- **It's the widest use of the grant.** The DLA licenses materials for use *within the
  Application*; an app icon also acts as MCO's identity outside it — installer, Start-menu
  shortcut, taskbar, any future download page. Nobody has been chased over this (EVE tools
  routinely ship game iconography) but it is the one asset that would have to change if CCP
  ever objected, and it matters more if A3 ends in a signed public release.

Redrawing an original clone-pod icon would remove both. Not required today; a decision to
record either way.

**The one thing only you can confirm:** that the EVE application behind the committed
`ESI_CLIENT_ID` was registered under your developer account with the DLA accepted. That's
an account-side fact, not visible from the repo.

Worth knowing, not a blocker: `LICENSE` is MIT, which lets downstream users sell copies,
while the DLA requires applications stay non-commercial. These don't actually collide —
MIT covers your code and cannot grant rights to CCP's IP, and anyone redistributing takes
on their own DLA obligations (pyfa ships GPLv3 on the same footing). Flagging it only so
the choice is a deliberate one.

### A6 · Housekeeping (P2) — ✅ done
- ~~Stray `mco-logs-20260726-0125.txt` in the repo root.~~ Untracked, deleted, and
  `mco-logs-*.txt` added to `.gitignore` in `c6ca9c9`.
- ~~`LATEST_SCHEMA_VERSION` sanity check.~~ Done, and made fatal rather than advisory:

  Migrations only move forward, so a profile whose highest applied version exceeds this
  build's was written by a later MCO. `runMigrations` never noticed — `pending` just came
  back empty — and the first query against a since-changed table was the symptom, nowhere
  near the cause. Now:

  - `schemaDowngradeMessage(dbVersion, appVersion)` (pure, unit-tested) decides whether a
    profile is readable and what to say if not; `runMigrations` throws `SchemaVersionError`
    on open.
  - `index.ts` catches it inside `whenReady`, shows the message in a dialog and quits.
    Without that the throw would only reject the promise and the app would silently never
    appear.
  - Settings → About reports `schema v24`, read from the database rather than from the
    constant — the useful readout is the one that *would* disagree if the guard were wrong.

  Verified end-to-end: a fresh profile opens normally; the same profile with
  `schema_migrations` forced to v99 refuses to start with *"This profile's database is at
  schema v99, but this build of MCO understands only up to v24."*

  `MIGRATIONS` is now exported and covered by tests asserting ascending order, no duplicate
  versions, and that `LATEST_SCHEMA_VERSION` really is the maximum — the guard is only as
  correct as that array's ordering, since it reads the last element.

---

## B. Correctness & robustness

### B1 · IPC error boundary (P2) — ✅ done
Was: `register.ts` handlers had no shared error wrapper, so a thrown service error
rejected the `invoke` and the renderer rendered `String(e)` — leaking raw internal
messages into the UI. Measured before the change:

```
Error: Error invoking remote method 'characters:detail': Error: Unknown character 999999
Error: Error invoking remote method 'tags:create': SqliteError: UNIQUE constraint failed: tags.name
```

Now, for those same two calls, the UI shows `Something went wrong. Settings → Export logs
has the details.` and `That name is already in use.`, while the log keeps the truth
(`[ipc] tags:create failed: SqliteError: UNIQUE constraint failed: tags.name`).

- **`handle()` in `register.ts`** — every `ipcMain.handle` routes through it: logs the
  full error with its channel via the captured logger, rethrows a normalized message.
- **`src/main/errors.ts`** — `toUserMessage` + a `UserFacingError` marker class. The
  wrapper alone would have destroyed the *good* messages (bad EFT paste, missing ESI
  scope, unconfigured client_id), so those ~7 throw sites are now `UserFacingError` and
  pass through verbatim; plain `Error` is the default and gets replaced.
  `SQLITE_CONSTRAINT_UNIQUE` maps to a real sentence rather than regressing the
  duplicate-tag-name case to the generic line.
- **Bridge cleanup (beyond the original plan, but required for the message to land
  clean):** `invoke()` in `src/preload/index.ts` strips the `Error invoking remote method
  '<channel>':` wrapper Electron adds, and `errorMessage()` in
  `src/renderer/src/lib/ipc.ts` replaces `String(e)` at all 32 renderer catch sites.

See the *Error boundary* section of [architecture.md](architecture.md). Covered by
`tests/unit/ipcErrors.test.ts` (11 cases) and two E2E cases asserting the UI text.

### B2 · JWT signature verification (P2) — ✅ done
Was: `pkce.ts:decodeJwtPayload` trusted the access-token JWT outright (the one `TODO` in
the tree) — defensible over direct TLS to `login.eveonline.com`, but nothing checked that
the token was signed by CCP, issued for *this* client_id, or unexpired.

Now every token is verified **at ingress** — in `startLogin()` and `refreshAccessToken()`,
before a character id, name or scope list is read out of it. Downstream code only ever
sees claims from a token that was verified when it was stored, so `decodeJwtPayload` stays
synchronous for `grantedScopes` and no call site had to become async.

- **`src/main/auth/jwt.ts`** — `verifyAccessToken()`: an algorithm **allowlist** (`RS256`,
  `ES256`) applied before any key is fetched, then the signature, then `iss` / `aud` /
  `exp` / `nbf` with 60 s of skew. The allowlist is the load-bearing part: taking `alg`
  from the token is what admits `alg: none` and the RS256→HS256 swap that uses the public
  key as the HMAC secret. Both are covered by tests that construct the actual attack.
- **`src/main/auth/jwks.ts`** — key set cached 12 h, `KeyObject`s memoized per kid, fetches
  **single-flighted** (with ~90 characters a scheduler sweep would otherwise fire ~90
  concurrent JWKS requests), one rotation refetch on an unknown kid behind a 5-minute
  cooldown. A failed refetch keeps a stale set — CCP rotates these on the order of years,
  so a stale key beats breaking every character's refresh — but with no cached set at all
  it fails closed.
- **Beyond the original plan:** `refreshAccessToken()` now also binds `sub` to the
  character it asked for, so a swapped response can't overwrite one character's token
  family with another's; and verification failures throw `UserFacingError` so a failed
  login names its reason instead of hitting B1's generic message.
- **Ordering, which fail-closed made load-bearing:** SSO rotates the refresh token the
  moment it answers, so by the time verification runs the token we sent is already dead.
  Verifying *before* recording the replacement would have meant a failed check discards it
  — turning "one sync failed" into "this character needs a fresh login," across all ~90 at
  once during a JWKS outage. The refresh token is opaque and isn't what verification
  checks, so it is now persisted first (carrying the previously recorded scopes), and the
  authoritative write with the token's real `scp` follows once the payload is trusted.
- `pkce.ts` is now just PKCE — the JWT concerns moved out to `jwt.ts`.

Checked against the live endpoints: `jwks_uri` and `issuer` match what the metadata
document advertises, and CCP publishes **both** an RS256 and an ES256 signing key — the
ES256 support means a rotation to the EC key is a non-event rather than an outage. The
real key set was run through `getSigningKey` end to end (fetch → select by kid+alg →
`createPublicKey` → memo, and an RS256 header correctly refused the EC key); that check
was not kept as a test, since a network dependency would make the pure-unit suite flaky.

See the *Access-token verification* section of [esi.md](esi.md). Covered by
`tests/unit/jwt.test.ts` (25 cases).

### B3 · Unhandled-rejection visibility (P2) — ✅ done
Was: an uncaught exception in the main process ended it with no message and no artifact.
The sharp edge is that *Settings → Export logs* is the only way to reach a session's log,
and a crash takes it with it — so the one failure most worth diagnosing was the one that
left nothing to diagnose.

- **`src/main/fatal.ts`** — `initFatalErrorHandler()` logs the error, writes
  `mco-crash-<stamp>.txt` next to the profile database, shows a dialog naming that file,
  then exits. The **file** is the deliverable; the dialog just says where it is. Three
  details are load-bearing: logging happens *before* the report is built (so the crash's
  own stack is inside it), the write is `writeFileSync` (an async write queued behind a
  dying event loop may never flush), and a re-entrancy flag stops a failure *while
  reporting* from looping. `app.exit(1)` rather than `app.quit()` — quit runs the normal
  teardown path, which is the code that just proved it can throw.
- **`buildDiagnosticsText()` extracted in `settingsService.ts`** — one builder now feeds
  both Export logs and the crash report, so they can't drift. Its header fields are read
  through a `safely()` wrapper: the crash being reported may be the database the header
  wants to read, and previously a single throw in `getAppInfo()` would have taken out the
  whole header. It also gained a `Schema:` line.
- **Beyond the original plan:** the `unhandledRejection` hook in `log.ts` called `record()`
  directly, which buffers without printing — so a rejection was invisible in a dev terminal
  and only surfaced in an export afterwards. It now goes through the patched `console.error`,
  which both prints and records. Rejections stay non-fatal (with ~90 characters syncing, one
  rejected background promise must not close the app); the listener is also what *keeps*
  them non-fatal, since Node's default since v15 is to rethrow.

Verified for real rather than by unit test: the built app was launched against a throwaway
profile and made to throw in the main process. `mco-crash-20260804-131428.txt` (1194 bytes)
appeared in the profile directory with a fully resolved header (`Schema: 24`,
`Database: … (4096 bytes)`), the ESI activity block, and a session log ending in the
induced stack trace. No permanent E2E case was added: the dialog is modal, so a crash test
would block the run on all three CI OSes.

See the *Crash handling* section of [architecture.md](architecture.md). Still open, and a
different problem: a **renderer** crash still shows a blank window (`render-process-gone`).

### B4 · Backup consistency (P3)
`exportBackup` copies `mco.sqlite` while the app holds it open in WAL mode. A raw file copy
can miss un-checkpointed WAL pages. Use better-sqlite3's `db.backup()` API (or run a WAL
checkpoint before copying) so the exported file is guaranteed consistent.

---

## C. Test & tooling gaps

### C1 · No DB-backed tests (P2)
All 262 tests are pure-unit (by design — great for speed). But repositories and
services (the SQL + orchestration) have **no automated coverage**; migrations,
delete-then-insert transactions, and the N+1 read paths are only exercised by hand or E2E.
better-sqlite3 runs fine in-process in vitest against a temp file — add a focused suite
that:
- runs `runMigrations` on a fresh temp DB and asserts `LATEST_SCHEMA_VERSION`,
- round-trips a repository (`replaceSkills` → `getTotalSp` → `getCharacterSkillMap`),
- exercises one service (`buildRoster`) against seeded rows.

This guards the layer most likely to break silently, and would catch the optimization
refactors in the [optimization path](optimization.md) regressing.

### C2 · E2E depth (P3)
E2E exists (`app.spec.ts`) but the app has grown a lot (Dashboard, Wallet, Groups, Clones,
Settings). Add smoke coverage that each route renders without a thrown error against an
empty profile — cheap insurance for the "no data yet" states.

---

## D. Product / UX polish (P3)

- **Auto-update**: none today. Fine for v0.1.0; when distribution stabilizes, wire
  `electron-updater` + a release feed so users aren't manually re-downloading.
- **First-run experience**: the app depends on an SDE import and an ESI `client_id`. The
  config banner + SDE banner handle this, but a one-time guided first-run (import SDE →
  add first character) would smooth onboarding.
- **Empty/loading states audit**: confirm every page has a defined state for "no
  characters," "SDE not imported," and "sync in progress" — most do; verify the newer pages
  (Wallet, Dashboard) match.

---

## Suggested sequencing

1. **Ship-blocking:** ~~A1 (icon), A2 (commit build inputs), A4 (CI packaging)~~ — done.
   Windows is verified end-to-end from a clean checkout of `HEAD` (see A2) and re-checked
   by CI on every push. Remaining: run `npm run dist` on macOS and Linux and smoke-test
   those installers — neither has ever been built.
2. **Trust decision:** ~~A5 (EVE terms)~~ — done. Remaining: A3 — decide signing scope
   and write it down.
3. **Hardening:** ~~B1 (IPC error boundary)~~, ~~B2 (JWT verify)~~, ~~B3 (crash
   diagnostics)~~ — done. Remaining: C1 (DB-backed tests).
4. **Everything else** as capacity allows.

None of B–D blocks generating working `.exe`s today — with A1/A2 done, `npm run dist`
produces installable artifacts. A3 determines whether they install *cleanly* for people
other than you.
