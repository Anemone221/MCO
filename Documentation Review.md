# Documentation review — 2026-11-14

A pass over `docs/`, `README.md`, `CLAUDE.md` and the comments in `src/` and `tests/`,
checked against the code as it stands (0.6.0 plus the uncommitted work).

**Part 1** is what needs a decision from you: places where the docs and the code (or two
parts of the code) disagree and it is not obvious which one is right. Nothing in Part 1
was changed. **Part 2** lists what was simply out of date and has been corrected.

How it was checked: every file path, identifier, IPC channel and link in the docs was
resolved against the tree by script; every identifier and file name mentioned in a code
comment was resolved the same way; then the numbers and behaviours the docs state
(intervals, limits, retention counts, startup order, CI steps, scopes, endpoints,
migrations) were compared with the constants and code by hand. Prose describing how a
page *looks* was not re-verified against the running app.

---

## Part 1 — Inconsistencies to decide

### 1. The docs say "run `npm run format`"; the tree is not Prettier-clean

- `docs/development.md` (Conventions): "run `npm run format` before committing".
- `docs/code-style.md` §1: "Enforced by Prettier … run `npm run format`", and the §12
  checklist starts with "`npm run format` clean".
- Reality: `npx prettier --check .` reports **132 files** with differences, and CI does
  not run a format check, so nothing enforces it.

Following the docs today would reformat 132 files in one commit. Options:

- **Make it true:** one formatting-only commit, then add `prettier --check` to CI.
- **Make the docs true:** say Prettier is the style reference but is not enforced, and
  that only touched lines should be formatted.

### 2. File naming rule vs three kebab-case files

`docs/code-style.md` §2 says modules are `camelCase.ts`. Three are not:

- `src/main/esi/rate-limiter.ts`
- `src/main/auth/esi-oauth.ts`
- `src/main/auth/token-store.ts`

(The guide even cited `rateLimiter.ts` as its example; that example now names a file
that exists.) Either rename the three — a mechanical change touching imports and every
doc that names them — or record them in the guide as grandfathered.

### 3. One error message still says "Re-add"; everything else says "re-authorize"

`src/main/services/structureService.ts:132` tells the user to "Re-add one character to
enable structure…". Every other message (character sheet, Mercenary Dens, Clones,
Mining, Blueprints) says "re-authorize … in Settings", which is the flow that exists
since the re-authorize queue. The docs now say "re-authorize" throughout; this string is
the last holdout. Left alone because it is user-facing text and a test may match it.

### 4. Crash reports ignore the dev database folder

`src/main/fatal.ts:37` writes `mco-crash-<stamp>.txt` to the root of `userData` whichever
database is in use, while the dev database, its backups and its restore marker live under
`userData/dev/`. Logs and the SDE download are shared on purpose (the docs say so); crash
reports were not mentioned either way. The docs now describe what the code does ("in the
profile folder"). Decide whether a dev-run crash file should go under `dev/` instead.

### 5. The release workflow runs fewer tests than CI

`.github/workflows/ci.yml` runs typecheck → lint → unit → **database tests** → build →
e2e. `.github/workflows/release.yml` runs typecheck → lint → unit → package: no
`test:db`, no e2e. The docs describe both accurately, so this is a gap between the two
workflows rather than a doc error. A tag pushed from a commit CI passed is covered; a tag
pushed from anything else is not.

### 6. `package.json` license field vs README

README says "Free, open source (MIT)" and `LICENSE` is the MIT text, but `package.json`
has `"license": "SEE LICENSE IN LICENSE"`. Harmless, but `"MIT"` is the SPDX value tools
read.

### 7. localStorage keys use two naming styles

- Dashed: `mco-theme`, `mco-demo-mode`, `mco-mining-period`,
  `mco-wallet-history-collapsed`, `mco-settings-sync-collapsed`.
- Dotted: `mco.roster.columns`, `mco.costView`, `mco.planAttributes`,
  `mco.podLocations.collapsed`.

The docs quote each correctly. Unifying them would reset those saved preferences unless
the old key is read as a fallback, so this is probably one to leave and simply pick a
style for new keys — say which, and it can go in `code-style.md`.

### 8. Two docs count the IPC steps differently

`docs/architecture.md` and `docs/development.md`: "touches exactly **four** files"
(shared, preload, channel module, the renderer caller). `docs/code-style.md` §6: "add a
channel in **three** places" (the same list without the caller). Not contradictory, but
a reader meets both numbers. Left as is; say which wording you prefer.

### 9. `CLAUDE.md` intro omits two features

The opening feature list in `CLAUDE.md` does not mention the **Wallet** page or the
**plan creator**. Not changed, since that file is your instructions to me rather than
plain documentation.

---

## Part 2 — Corrected in this pass

### `docs/architecture.md`

- Process diagram: added the main-process folders it had lost (`skills/`, `clones/`,
  `blueprints/`, `mercenary/`, `mining/`, `map/`, `structures/`, `logFile.ts`,
  `fatal.ts`, `webSecurity.ts`) and the pages added since (Blueprints, Mining,
  Mercenary Dens, PlanCreator, GroupDetail).
- `McoApi` domains: listed 12, there are 19.
- Push channels: said "two event channels"; `IPC_EVENT_CHANNELS` has six.
- Repository list: listed 14 modules, there are 25.
- Pure-logic paragraph: noted that `lib/ipc.ts`'s demo wrapper *is* unit-tested
  (`tests/unit/renderer/`), and added the database-backed test layer.
- Tray menu item is "Quit MCO", not "Quit".
- Quit sequence also flushes the log file; added a pointer to the `--db` switch.
- Background sync: the sweep runs four notification checks after the sync (the doc named
  one) and does its housekeeping before it.
- Crash report location: "in the profile folder", not "next to the profile database"
  (see Part 1 item 4).
- "What syncs where": added attributes, wallet, journal, mining, blueprints, mercenary
  dens, alt-corp blueprints, structure and planet names.
- Storage locations: added `backups/`, `dev/`, `logs/` and the crash file.

### `docs/features.md`

- Sections reordered to the sidebar order the first paragraph promises: Wallet, Mining
  and Mercenary Dens moved from before Roster to after Blueprints. Text unchanged.
- Roster context menu named `RosterContextMenu`, a component that no longer exists —
  now `CharacterContextMenu` / `useCharacterContextMenu`.
- Dashboard motion bullet still mentioned "ForceDirected settling"; that chart was
  replaced by `Pack`.
- Character sheet: added the skill radar chart (`SkillGroupRadarChart`), which no doc
  mentioned.
- Settings: "Seven sections" → eight; Notifications moved to where it sits on the page
  (after Background sync); added the ESI activity panel.
- "re-add the character" → "re-authorize" in four places, matching the UI.
- Broken link `esi.md#login-flow` fixed.

### `docs/database.md`

- Opening: noted the dev database location.
- Migrations: noted the pre-migration snapshot and the prod-migration prompt.
- `app_settings`: added the `live_tracking` and `notify:<kind>` keys.
- The migration table (v1–v40) was checked against `migrations.ts` and is correct.

### `docs/development.md`

- Environment variables: added `MCO_ESI_COMPAT_DATE` and `MCO_TEST_LOG`.
- Unit tests: replaced a "current suites" list naming 17 of ~70 files with the naming
  rule.
- Database tests: added the `dbMode`, `batchReads` and `scheduler` suites and the
  Electron stand-ins they use (`showMessageBoxSync`, `net.isOnline`, `powerMonitor`).
- Charts: added the `radar` import subpath.

### `docs/code-style.md`

- §2 example file name `rateLimiter.ts` → `queueDrain.ts` (see Part 1 item 2).
- §5 "exactly one `TODO:` in the tree — the JWT-signature note": there are none; token
  signatures are verified now.
- §9 showed a hand-rolled `useEffect` + `onChanged` + `String(e)` loading pattern — the
  exact thing `CLAUDE.md` forbids and no page does. Replaced with `useMcoData`.
- §10 "262 tests" → about 800; added the `tests/db/` layer, which the "mock nothing"
  rule read as ruling out.
- §11 added the navigation / external-URL / permission policy (`webSecurity.ts`).
- §12 checklist: added `npm run test:db`.

### `README.md`

- "Where your data lives": added `backups/` and `logs/`; the restore paragraph now
  mentions Settings → Backup → Restore…, which it predated.
- Scopes note: "needs re-adding" → "needs re-authorizing (Settings → Sync status)".
- Contributing: added `npm run test:db` to the commands.

### Code comments

- `src/renderer/src/components/ColumnPicker.tsx`: comment referred to
  `RosterContextMenu`; now `CharacterContextMenu`. This was the only stale reference the
  comment scan found across `src/` and `tests/`.

### Checked and found correct (no change)

- `docs/esi.md`: scope list, endpoint table (all 25 wrappers), retry/throttle/timeout
  constants, JWKS cache and refetch intervals, wave size, page caps, cooldowns.
- `docs/sde.md`: pipeline files, progress stages, the six capability flags, the download
  stall timeout.
- `docs/development.md`: npm scripts against `package.json`, CI and release steps
  against the workflow files, `tsconfig` include/exclude claims.
- Live-tracking and scheduler intervals, backup retention counts, log size limits and
  notification windows in all docs match their constants.
