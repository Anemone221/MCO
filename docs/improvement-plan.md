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

### A2 · Commit the build inputs (P0)
`build/` and `resources/` are untracked. They're required for `npm run dist` to produce a
correct package. Commit them (they're not in `.gitignore`).

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

### A4 · CI never packages (P1)
CI runs `build` but not `electron-builder`, so a broken packaging config (a bad `files`
glob, an `asarUnpack` regression for `better-sqlite3`, a missing icon) is only caught by a
manual `npm run dist`. Add a `dist:dir` (unpacked, no installer — fast) job to CI, at
least on `windows-latest`, so packaging is exercised on every push. Optionally upload the
artifact.

### A5 · EVE third-party distribution terms (P1 — non-code)
MCO is a third-party EVE tool distributing an app that logs into players' accounts. CCP has
a developer-app / third-party policy governing this (naming, "not affiliated with CCP"
disclaimer, ESI usage). Confirm compliance and add the standard disclaimer to the
README/About before public distribution. The `USER_AGENT` already carries contact info
(good ESI citizenship).

### A6 · Housekeeping (P2)
- `mco-logs-20260726-0125.txt` is a stray diagnostics export sitting in the repo root. Add
  `mco-logs-*.txt` to `.gitignore` (or the broader `*.txt` if safe) and delete the file.
- Consider a `LATEST_SCHEMA_VERSION` sanity check surfaced in the Settings/About panel so a
  downgrade (opening an old build against a newer DB) fails loudly rather than mid-query.

---

## B. Correctness & robustness

### B1 · IPC error boundary (P2)
`register.ts` handlers have no shared error wrapper — a thrown service error rejects the
`invoke` and the renderer renders `String(e)`, which leaks raw internal messages
(`Unknown character 123`, SQL text on a constraint failure) into the UI. Add one wrapper
that:
- logs the full error (with the channel name) via the captured logger, and
- returns/throws a normalized, user-safe message.

This is a small, high-leverage change — one helper in `register.ts` that every
`ipcMain.handle` routes through.

### B2 · JWT signature verification (P2)
`pkce.ts:decodeJwtPayload` trusts the access-token JWT without verifying its signature (the
one `TODO` in the tree). It's defensible — the token arrives over direct TLS from
`login.eveonline.com` — but verifying against the SSO JWKS endpoint closes a real gap
(cached/tampered token, future proxy in the path). Fetch and cache the JWKS, verify `iss`,
`aud`, `exp`, and the signature. Low urgency, worth doing before wide distribution.

### B3 · Unhandled-rejection visibility (P2)
`log.ts` records `unhandledRejection` into the export buffer — good. Consider also a
top-level `uncaughtException` handler that logs and shows a dialog before quit, so a
main-process crash produces a diagnostic instead of a silent disappearance.

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

1. **Ship-blocking:** A1 (icon), A2 (commit build inputs), A4 (CI packaging), then run
   `npm run dist` on all three OSes and smoke-test the installers. This gets you real,
   correct `.exe`s.
2. **Trust decision:** A3 + A5 — decide signing/distribution scope and write it down.
3. **Hardening:** B1 (IPC error boundary), C1 (DB-backed tests), B2 (JWT verify).
4. **Everything else** as capacity allows.

None of B–D blocks generating working `.exe`s today — with A1/A2 done, `npm run dist`
produces installable artifacts. A3 determines whether they install *cleanly* for people
other than you.
