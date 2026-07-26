# Features

Sidebar navigation and Settings section headers use inline SVG icons
(`components/icons.tsx`) with path data from free icon sets — Feather (MIT),
Lucide (ISC), and the Simple Icons GitHub mark (CC0) — inlined so the strict CSP
needs no external hosts and no icon dependency is added.

One section per page (sidebar order), then the shared skill-analysis engine and
notifications. Renderer pages live in `src/renderer/src/pages/`; the services that feed
them in `src/main/services/`.

## Dashboard (`/`, `pages/Dashboard.tsx`)

The landing page: a tile row of army-wide stats plus a packed-circles chart of
every character sized by SP, assembled by `buildDashboardSummary()`
(`services/dashboardService.ts`).

- **Tiles**: ESI Status (Tranquility online/offline + player count from the public
  `/status/` endpoint, alongside MCO's own ESI-call health read straight off
  `esi/rate-limiter.ts`'s backoff state); Characters online (scope-gated,
  `esi-location.read_online.v1` — see below); Characters registered; Total SP;
  Ratted ISK this month (NPC bounty prizes + ESS reserve payouts + mission/incursion
  rewards, kept as separate bounty/mission sub-totals so the combined tile can still
  show the breakdown — the detailed by-day chart lives on the **Wallet** page).
  Headline numbers count up (`lib/useCountUp.ts`) and tiles stagger in on load.
- **Characters by total SP** (`components/charts/CharacterSpChart.tsx`): an amCharts
  5 single-level packed-circles chart (`Pack`, the d3 circle-packing layout), one
  circle per character sized by total SP — biggest circle = most SP, packed toward
  the centre (`sort: 'descending'`). Pack is deterministic and always fits the
  container, unlike the ForceDirected physics graph it replaced (which sized nodes
  inconsistently and pushed them off-screen). Each circle is filled with the
  character portrait: an `am5.Picture` on the node clipped by a circle mask, sized
  reactively to the circle's packed radius (`circle.on('radius', …)`). Labels are
  portrait-only, with the name + SP shown on hover; **clicking a circle opens that
  character's sheet.** Built on the reusable `components/charts/useAmChart.ts`
  wrapper (root lifecycle, Animated theme, palette from the active theme's CSS
  variables). *Demo-safe*: in demo mode the portrait URL is null and circles fall
  back to the chart's color set, so real portraits never leak (mirrors
  `CharacterAvatar`). Empty roster shows the standard empty state instead.
- **Motion**: all dashboard animation draws from the shared `--anim-*` tokens in
  `styles.css`; the OS reduced-motion preference disables CSS animation globally
  and JS-driven motion (count-ups, chart entrance, ForceDirected settling) via
  `prefersReducedMotion()` in `renderer/lib/motion.ts`.
- **Characters online** requires the `esi-location.read_online.v1` scope added
  alongside every other Dashboard-driving scope; characters added before this scope
  existed count toward `missingScopeCount` until re-added (same one-time re-login
  pattern used for every prior scope addition — see [esi.md](esi.md#changing-scopes)).

## Wallet (`/wallet`, `pages/Wallet.tsx`)

Current-month ratted income, from `buildWalletSummary()`
(`services/walletService.ts`): headline tiles (total / bounties / missions) plus
**Ratted ISK by day** (`components/charts/IncomeByDayChart.tsx`) — amCharts 5
stacked bounty/mission columns for the current UTC month, zero-filled through today
(`sumIncomeByDayBetween` + `fillMonthDays` in `main/wallet/monthIncome.ts`). Built
on the same `useAmChart` wrapper (Animated theme, palette recolors on theme switch,
ISK-style number abbreviations). Free amCharts tier: the small logo on the chart is
the license condition. Months with no income show a quiet placeholder instead of an
empty chart. Income data (bounty = NPC bounties + ESS payouts; mission = agent
mission rewards) is synced from each wallet-scoped character's journal — see
[esi.md](esi.md#dashboard-specific-sync-notes).

## Roster (`/roster`, `pages/Roster.tsx`)

The home table: every character with account, capability tags, last-known location and
ship, currently-training skill, time left, jump fatigue, jump-clone availability
(ready vs. cooldown countdown), total SP, wallet balance, and last sync.
Built by `buildRoster()` (`services/characterSync.ts`).

- **Filters**: free-text search (name / account / training skill / system / ship),
  account (incl. "unassigned"), training vs. idle, and tag.
- **Sorting**: every column, with sensible empty-value grouping (unassigned/untagged/
  never-synced always sink to the bottom regardless of direction). Pure logic in
  `lib/rosterView.ts`.
- **Column picker** (`ColumnPicker`): all columns except Character are toggleable;
  visibility persists in `localStorage` (`mco.roster.columns`), merged over defaults so
  newly added columns default to visible.
- **Context menu** (`RosterContextMenu`): right-click a character to assign/remove
  capability tags and add/remove group memberships in place.
- **Add character** launches the SSO login flow (see [esi.md](esi.md#login-flow));
  per-row Sync / Sync all / Remove.
- Summary chips: total characters, training, idle, combined SP.
- Training status is *derived*, not stored: queue position 0 with a future finish date.

## Character detail (`/character/:id`, `pages/CharacterDetail.tsx`)

The single-character sheet, assembled by `services/characterDetail.ts`:

- From DB: total SP, full skill queue (SDE-resolved names), wallet balance, jump
  fatigue, neural attributes (the five stats, bonus remaps, yearly-remap
  availability), jump clones, group memberships, capability tags, per-plan progress
  (complete / SP gap / % bar). The wallet scope postdates early tokens, so the wallet
  card classifies why a balance is absent (`EsiDataStatus`) instead of a bare empty
  state — re-add the character to grant the scope.
- Toolbar **status squares** (Fatigue / Jump Clone / Training): traffic-light
  red/green pills answering "can this character act right now" — a deliberate
  exception to the in-game color convention used elsewhere. Training is green when
  this character trains, grey Idle when an account sibling holds the training slot,
  and red when an Omega account (the `is_omega` checkbox on Accounts) is training
  nobody.
- Live from ESI (each independently fault-tolerant — one failure never blanks the
  page): current location, current ship, active implants.

## Accounts (`/accounts`, `pages/Accounts.tsx`)

CRUD for account buckets and character→account assignment. Accounts are manual: ESI
never reveals which account a character belongs to. Assignment answers "which account
is training what" — one character per account can train at a time, so an account whose
characters are all idle is wasting training time. Each account has a user-maintained
**Omega checkbox** (ESI can't reveal Omega status either); it drives the red idle
warning on the character sheet's Training status square.

## Groups (`/groups`, `pages/Groups.tsx`)

CRUD for user-defined organizational groups + membership management. A character can be
in zero or many groups. Groups say where a character *belongs* ("WH defense"), never
what it can do — that's tags.

## Group page (`/groups/:id`, `pages/GroupDetail.tsx`)

The per-group status board, assembled by `services/groupService.ts`
(`buildGroupDetail`). One dense card per member: portrait, name, account, location,
ship, medical-clone location, total SP, training status (current skill + time left),
skill-queue summary (entries queued + when the queue ends; paused/finished called
out), and capability tag chips.

A group can be given a **priority fit** and/or **priority skill plan** — the thing
every member of this group should be working toward. When set, each member card grows
a progress bar per objective (same red→green bar as the character sheet's plan card):
% trained, SP left, "Can fly"/"Complete" when done. Progress is computed in one
analysis pass per objective (`fitObjectiveStatus` / `planObjectiveStatus`), using a
phantom zero-SP character to get the objective's from-zero SP cost. Deleting a fit or
plan clears the reference (`ON DELETE SET NULL`).

A group can also be given a **home station**: a type-ahead search over the imported
`structures` table (`structures:search` → `searchStructures`) assigns the structure
every member's **medical clone** should be at (`home_station_id`/`home_station_name`,
name denormalized so display survives later ACL loss). Any member whose medical clone
is verifiably elsewhere gets a red halo around its card and its "Med clone" line turns
red (`medicalCloneMismatch` in `renderer/lib/groupView.ts`). Only the medical clone is
compared — where the character currently sits is irrelevant — and a member with no
home station set or no clone data synced is never flagged (missing data is not an
alarm). NPC stations aren't searchable yet (no local station table); a medical clone
in an NPC station still flags correctly because the location ids differ.

### Pod locations (implant whitelist)

A group can carry a whitelist of solar systems (`group_pod_systems`, picked via a
type-ahead over SDE systems, `systems:search` → `searchSystemsByName`) where members'
**pods carrying implants** are allowed to sit — e.g. "all implanted pods live in Jita
or Amarr". The group page lists every offending pod so it can be moved: the **active
body** (checked against the character's current system) and every **jump clone** with
at least one implant (station systems via public ESI, structure systems via the
`structures` table). The pure check lives in `src/main/clones/podWhitelist.ts`
(`flagPodsOutsideWhitelist`). Missing data is not an alarm: an active pod whose
location never synced isn't flagged, and a jump clone in an *unresolved* structure is
listed with a muted "unresolved" system rather than a red one (it can't be verified —
it could be anywhere). An empty whitelist disables the check.

The section is collapsible (chevron in the header; persisted per group in
localStorage, `loadPodSectionCollapsed` in `renderer/lib/groupView.ts` — the "N to
move" chip stays visible while collapsed) and splits its pods over two tabs.
**To move** lists the flagged pods; right-clicking a row offers **Ignore**, which
exempts that pod from the check (`group_pod_ignores`, per group; the active pod is
stored as clone id 0). **Ignored** lists every exemption — including pods that are
now compliant or whose clone no longer exists ("no longer exists") — with an
Un-ignore button to lift it. Ignores are keyed by ESI jump-clone id, so jumping into
an ignored clone retires the exemption naturally (the id disappears).

## Tags (`/tags`, `pages/Tags.tsx`)

CRUD for capability tags ("Is able to Cyno") + assignment. Names are unique
(case-insensitive); tags carry an optional color used by chips throughout the UI.
Tags are character-level and group-independent by design — see the Organization model
in [CLAUDE.md](../CLAUDE.md#organization-model).

## Location (`/location`, `pages/Location.tsx`)

Where everyone is: system (with security color-coded high/low/null), region,
docked/undocked, ship, and data age. Fed by `buildLocationBoard()`
(`services/locationService.ts`) from the last sync's `character_location` rows —
system/region names resolve only after the SDE map import. Docked characters also
show *where*: NPC station names via public ESI, player-owned citadel names from the
`structures` table (see below); the search box matches them.

### Structure (citadel) import

Player-owned Upwell structures only expose their name through the **authed**
`/universe/structures/{id}` route (`esi-universe.read_structures.v1`), and only to
characters on the structure's ACL. Both resolution paths write to the shared
`structures` table (`services/structureService.ts`); **one** character with the
scope is enough — public structures have open ACLs, so any scoped token resolves
them all.

- **Bulk import** ("Import structures" on the Location page →
  `structures:import`): fetches the full public-structure id list from the
  *unauthed* `/universe/structures` route (~900 ids), then resolves every
  unknown/stale id through a scoped character, streaming progress over
  `structures:importProgress`.
- **Sync-side**: during each character's sync, the structure ids it references
  (docked location, jump-clone locations, medical clone) are resolved — via the
  character's own token when it has the scope (it's the one most likely to be on
  a *private* structure's ACL), otherwise via any scoped character.

Resolution is throttled by `structures/refreshPolicy.ts` (weekly refresh, daily
retry after a 403) and deduped in-flight so neither path fetches the same citadel
twice. Structures nobody can access keep showing as `Structure <id>`.

## Fits (`/fits`, `/fits/:id`)

**The "how many of my characters can fly this?" feature.**

- Import: paste EFT text (`[Hull, Fit name]` + module lines). Parsed by
  `fits/eft.ts` — handles charges (`Module, Charge`), quantity lines (`Item xN`),
  empty-slot placeholders, and `/OFFLINE` suffixes. The raw text is stored; analysis
  re-parses on demand.
- Analysis (`services/fitService.ts` → `fits/analyze.ts`): resolves every item name
  via the SDE, collects skill requirements of the hull + fitted modules/charges +
  drones (`xN` items count only if their SDE category is Drone, Charge or Module —
  spare mining crystals, ammo and cargo modules count; inert cargo like ore is
  listed but not counted), expands the full prerequisite closure, then per
  character reports:
  - `canFly` — meets every *direct* requirement at the required level;
  - `spGap` — total missing SP including untrained prerequisites;
  - `lsiGap` — whole Large Skill Injectors to cover the gap, simulated sequentially
    through EVE's diminishing-returns tiers (<5m → 500k, 5–50m → 400k, 50–80m → 300k,
    ≥80m → 150k SP each; total SP = the character's summed skill SP, `fits/cost.ts`);
  - `timeGapMinutes` — attribute-based training time (SP/min = primary + secondary/2
    from the character's synced neural attributes; per-skill attributes from
    `sde_skill_attributes`). Null when attributes haven't synced or the SDE predates
    the training-attribute import — never a partial sum;
  - `missingSkills` — per-skill have/need levels and SP deltas, largest first.
- The result buckets can be measured in any of three **cost systems** — SP, Injectors
  or Time — each with its own "almost there" threshold. The selected system +
  thresholds persist per fit in localStorage (`lib/costView.ts`); characters with an
  unknown time cost bucket conservatively as "further away".
- Unresolved names (typos, unimported SDE) are surfaced, and analysis is gated on
  `hasSkillData` (returns `needsSkillData` instead of wrong numbers); the Time system
  additionally surfaces `needsSkillAttributes` with a re-import hint.
- Right-click any character in the result buckets to assign tags or group
  memberships in place (`components/useCharacterContextMenu.tsx` — same menu as the
  Roster) — e.g. import a fit, then tag/group everyone who can fly it.
- **Bulk section tagging** (`components/BulkTagBar.tsx`): the "Can fly fully" section
  header carries an **+ Assign tag** dropdown that applies one capability tag to every
  character in that section at once — the initial-setup "everyone who can fly this can
  Cyno" workflow. Pick an existing tag or create a new capability inline; each tag
  shows how many of the section already hold it (`n/total` or `✓ all`,
  `sectionTagCoverage` in `lib/tags.ts`). Assignment goes through a single-transaction
  bulk write (`tags.addMembers` → `addTagToCharacters`).

## Skill Plans (`/plans`, `/plans/:id`)

Same engine, aimed at goals instead of ships.

- Import: name + pasted plan text, one `<skill name> <level>` per line (roman I–V or
  digits 1–5; junk lines are skipped). Parser: `plans/parse.ts`.
- Analysis (`services/planService.ts`): resolves skills, expands prerequisites, and per
  character reports `complete` / `spGap` / `lsiGap` / `timeGapMinutes` /
  `missingSkills` — literally `analyzeFit` with `canFly` renamed (`plans/analyze.ts`).
- The same three cost systems (SP / Injectors / Time) and per-plan thresholds as fits;
  the system chosen on a plan's detail page also decides how that plan's gap reads on
  group objective bars and the character sheet (SP fallback when time is unknown).
- Per-character plan progress on the character sheet is computed by also analyzing a
  synthetic zero-skill character: its gap is the plan's total from-zero SP cost, and
  `1 - myGap/totalCost` is the progress fraction — same math both sides, no drift.
- Result buckets support the same right-click tag/group assignment as fits, and the
  "Plan complete" section carries the same **+ Assign tag** bulk control (`BulkTagBar`).

## Clones (`/clones`, `pages/Clones.tsx`)

Implant and jump-clone board, fed by `buildCloneBoard()` (`services/cloneService.ts`):
active-clone implants and every jump clone (custom name, location, implants) per
character. NPC station names resolve via public ESI (cached); player-owned structure
names come from the `structures` table (see the structure-import section above),
falling back to `Structure <id>` while unresolved. Each row carries an `EsiDataStatus` so the UI can
distinguish "not synced yet" from "token lacks the clones/implants scopes" (tokens from
before those scopes were added) from "login expired".

Each row (and the character sheet's Overview card) also shows **clone-jump
readiness**: ESI's `last_clone_jump_date` plus a 24h cooldown minus 1h per level of
Infomorph Synchronizing (pure math in `clones/jumpCooldown.ts`, using the skill's
*active* level). On cooldown it renders as a fatigue-blue countdown chip; "JC ready"
otherwise.

The **medical (home) clone location** — ESI's `home_location` from the same clones
endpoint — appears on the character sheet's Overview card and in each expanded
board row. Station and structure names resolve the same way as clone locations.

## Notifications

- **Detection** (`notifications/queueDrain.ts`, pure): a character whose skill queue
  has exactly one entry (nothing queued behind the training skill) finishing within
  **3 days** is about to waste training time.
- **Delivery** (`services/notificationService.ts`), after each scheduler sweep: writes
  to the `notifications` table (deduped by `queue-drain:<charId>:<finishDate>` so each
  occurrence notifies exactly once), pushes `notifications:changed` to the renderer,
  and shows an OS toast (clicking it marks read + focuses the window).
- **UI** (`components/NotificationBell.tsx`): sidebar bell with unread badge,
  mark-read/mark-all-read.
- The `kind` column + dedupe-key pattern is ready for more notification types
  (e.g. fatigue expired, extraction ready).

## Settings (`/settings`, `pages/Settings.tsx`)

Opened via the gear button at the bottom of the sidebar (next to the notification
bell). Six sections:

- **Sync status** (`services/settingsService.ts` → `buildSyncStatus()`): a
  collapsible section (state persisted in `localStorage`) whose header shows
  at-a-glance `StatusSquare` pills — Fresh x/y, Due, Logins — reusing the character
  sheet's traffic-light squares (`components/StatusSquare.tsx`), plus "Sync all now".
  The body holds scheduler facts (running, last/next hourly sweep — tracked in
  `services/scheduler.ts`), SDE install state, structure name-resolution counts, and
  a per-character table (last synced, next due, state). The state per character is
  classified by `sync/characterSyncState.ts` (pure, unit-tested): `ok` (skills cache
  still fresh), `due` (cache lapsed — routine, the next sweep picks it up),
  `never-synced`, or `login-expired` (alarming, chip in red). Rows also flag tokens
  missing scopes from the current `ESI_SCOPES` set.
- **Appearance**: theme picker. Themes are CSS custom-property override blocks in
  `styles.css` keyed off `data-theme` on `<html>` (`dark` default, `holo` — a sci-fi
  cyan HUD look with theme-scoped glow rules, `light`, `void`, `amber`). Definitions
  live in `lib/theme.ts` (pure); applying/persisting in `renderer/src/theme.ts` — the
  choice is stored in `localStorage` and applied in `main.tsx` before first render,
  so no theme flash.
- **Demo mode** (`lib/demo.ts`): a toggle (persisted in `localStorage`) that swaps
  identifying data — character names, account labels, system/region/station names,
  player-assigned ship names, portraits, OS-user path segments — for deterministic
  made-up equivalents, so screenshots don't expose the roster. Display-only: the
  scrub is applied in `lib/ipc.ts`, the wrapper every page imports instead of
  `window.mco`, so no page can bypass it; nothing in the database changes. Mappings
  are stable per real id/name within a session (hash into invented-name pools with
  collision probing), keeping rows distinguishable and consistent across pages.
  `CharacterContextMenu` names, group/tag/fit/plan names stay real (user-defined,
  the thing being demoed). Portraits render as deterministic colored blocks
  (`components/CharacterAvatar.tsx`).
- **Logs**: `main/log.ts` patches `console.log/warn/error` in the main process at
  startup into a 5000-line ring buffer; "Export logs…" saves a diagnostics file
  (version/runtime/platform/DB header + the session log) via a save dialog.
- **Backup**: "Back up database…" writes a consistent snapshot via better-sqlite3's
  online backup API (WAL-safe, app keeps running) to a user-chosen path; restore =
  quit MCO and copy the file back over `mco.sqlite`. Refresh tokens are
  `safeStorage`-encrypted per OS user, so a backup restored on a different
  machine/user keeps all data but characters must be re-added. "Open data folder"
  opens the profile directory.
- **About**: version/runtime facts plus GitHub repository and issue-tracker links
  (opened externally via the window-open handler).

## The skill-analysis engine (`fits/analyze.ts`)

Shared by fits and plans; pure and unit-tested.

- **SP formula**: `spForLevel(rank, level) = 250 × rank × √32^(level-1)`, the standard
  EVE progression (level V of a rank-1 skill = 256 000 SP).
- **Prerequisite closure**: `buildSkillPrereqMap` walks the transitive prerequisite
  tree breadth-first, batching SDE lookups per frontier; `expandClosure` then computes
  the required level per skill (max-merged — prerequisites are demanded at the level
  needed to train the dependent skill).
- **Distinction that matters**: `canFly` (fits) / `complete` (plans) checks only
  *direct* requirements against trained levels, while `spGap`/`missingSkills` price the
  *full closure* against actual SP (partial training counts — SP already in a skill
  reduces the gap).
- **Cost metrics** (`fits/cost.ts`, equally pure): `injectorsForGap` simulates
  sequential Large Skill Injector use through the diminishing-returns tiers;
  `trainingTimeMinutes` prices the missing-skill list at each skill's own
  primary/secondary attribute rate — all-or-nothing (null rather than a partial sum
  when any skill lacks attribute data or the character's attributes aren't synced).
