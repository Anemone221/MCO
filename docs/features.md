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
  Income this month — everything earned: NPC bounty prizes + ESS reserve payouts,
  mission/incursion rewards, and CONCORD reward payouts, kept as separate
  sub-totals so the combined tile can still show the breakdown. Donations are *not*
  income (ISK handed over is a transfer, and it has its own Wallet card). The by-day
  chart and every other wallet category live on the **Wallet** page.
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

Where every character's ISK went this month, from `buildWalletSummary()`
(`services/walletService.ts`). One SQL pass over the stored journal slice
(`sumWalletTotalsBetween`) fills the card row; the same aggregate grouped by month
(`sumWalletTotalsByMonth`) fills the history view.

- **Cards** (`components/StatTile.tsx`, shared with the Dashboard): Income, then the
  three categories that make it up — Bounties (NPC bounties + ESS payouts), Missions
  (agent mission rewards) and Corporate reward payout — followed by Tax paid,
  Expenses and Player donations.
  - **`corporate_reward_payout` is not a corp project.** The payer is CONCORD
    (`first_party_id` 1000125, *"CONCORD rewarded &lt;name&gt; for services
    performed"*) settling a completed site, which makes it PvE income like a bounty.
    The name is CCP's, and the card keeps it so it matches the in-game journal.
  - **Income is everything earned**, those reward payouts included: leaving them out
    of a tile labelled "Income" makes it read as wrong to anyone who knows what they
    were paid. `IncomeSummary` carries `corpRewardIsk` alongside bounty/mission, and
    the history chart plots bounties+missions and reward payouts as two stacked
    series rather than one total over its own part.
  - **Tax paid** is every `*_tax` ref_type that took ISK **plus** the `tax` ESI
    reports on the entry itself: a corp-taxed bounty pays out net, with the cut in
    that field rather than in a journal row of its own, so ignoring it would hide
    the largest tax line a null-sec ratter has.
    *It is tax ESI told us about, not all tax paid* — and the card says so. The
    in-game journal pairs every CONCORD reward with a `Corporate Reward Tax` row
    (45M gross / −4.5M tax), but ESI's character journal returns neither that row
    nor a `tax` field for it, only the net 40.5M. Measured over one 73-character
    roster's full 30-day journal (2,689 entries), ESI returned exactly **one**
    `*_tax` row in total — so treat the total as a floor.
  - **Expenses** are the costs of running the roster: every `*_fee` ref_type (a
    suffix rule for the same reason tax uses one) plus `skill_purchase`,
    `structure_gate_jump` (Ansiblex tolls), `planetary_construction` and
    `repair_bill`. Only negative amounts count, so a refunded fee cannot read as
    spending. **Not** included: `market_escrow` (ISK parked against a buy order),
    `player_trading` and `corporation_account_withdrawal` (your own ISK moving),
    and the contract ref_types — a contract can be a purchase or a sale, and
    guessing which would make the figure fiction.
  - **Player donations** separate in from out, and both from ISK shuffled *between*
    tracked characters — with 90+ characters, moving ISK to a trading alt is
    constant, and counting it as income would drown the real number. A donation is
    internal when the counterparty id is one of the roster's characters; only the
    receiving side is counted, so a transfer between two synced characters lands
    once.
- **Income by day** (`components/charts/IncomeByDayChart.tsx`) — amCharts 5 stacked
  columns for the current UTC month, zero-filled through today
  (`sumWalletTotalsByDay` + `fillMonthDays` in `main/wallet/monthIncome.ts`).
  Carries all three income categories — missions, bounties, reward payouts — so a
  column sums to exactly what the Income tile counts, and each segment's tooltip
  repeats the day total. Outgoings stay off this chart on purpose: seven classes
  over 31 columns pushes past the ~7 where adjacent classes blur, so tax,
  expenses and donations are the monthly chart's job. Stacking order is set by
  the palette, not preference — `--ok` and `--warn` are only ΔE 5.1 apart under
  protanopia, so bounties (`--accent`) sit between them. Bounties and reward
  payouts keep the hues they have on the monthly chart: color follows the
  category, not its position.
  Months with no income show a quiet placeholder instead of an empty chart.
- **Previous months** — collapsible (collapsed by default, remembered in
  localStorage under `mco-wallet-history-collapsed`; this month is the page, history
  is the aside). Inside: `components/charts/WalletHistoryChart.tsx`, one stacked
  column per completed month with earnings above the zero line and tax / donations
  sent below it, over a compact table of the exact figures. Up to 12 completed
  months (`previousMonthsBoundsUtc`), which never includes the month in progress.
  Six series over five hues: donations reuse one hue in both directions (the side
  of the zero line says which way the ISK went), with the outgoing side dimmed.
  **History starts at the first sync**: ESI's journal reaches ~30 days back, so
  the table is the archive — see [esi.md](esi.md#dashboard-specific-sync-notes).

Both charts are built on the `useAmChart` wrapper (Animated theme, palette recolors
on theme switch, ISK-style number abbreviations). Free amCharts tier: the small logo
on the chart is the license condition. Both separate stacked segments with a 2px
stroke in `--panel` — a gap in the surface color, not a border around each fill.

Series hues come from the theme's semantic tokens, so the themes have to keep those
tokens distinguishable from each other, not just from the background: `amber` needed
its own `--warn` (its accent *was* the default `--warn`, the same hex) and `holo`'s
`--ok` was within ΔE 15 of its aqua accent. Both are fixed in `styles.css`. The
remaining known deviation is lightness band — the tokens are the app's status
colors first and chart series second, so they are not re-stepped for charting.

## Roster (`/roster`, `pages/Roster.tsx`)

The home table: every character with account, capability tags, last-known location and
ship, currently-training skill, time left, queue left, jump fatigue, jump-clone
availability (ready vs. cooldown countdown), total SP, wallet balance, and last sync.
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
- Training status is *derived*, not stored: the head of the *pending* queue
  (`skills/queue.ts` — see [esi.md](esi.md#finished-skill-queue-entries)) with a future
  finish date.
- **Time left** is the current skill; **Queue left** is the whole queue running dry (the
  last entry's finish date). A queue with skills but no dates is paused — EVE clears queue
  dates while training is paused — so it shows "Paused" and sorts with the empty ones.

## Character detail (`/character/:id`, `pages/CharacterDetail.tsx`)

The single-character sheet, assembled by `services/characterDetail.ts`:

- From DB: total SP, pending skill queue (SDE-resolved names; finished entries
  trimmed, so the count matches the in-game queue), wallet balance, jump
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

The group and **tag** filters narrow the page, which is what makes the ranking below
answer "which of my *cyno* alts", not just "which of my characters". Right-clicking a
character opens the usual tag/group menu.

### Nearest to a system

Pick a target system in the filter bar ("Nearest to system…", `TargetSystemPicker`)
and the board is replaced by a ranked table: every character with a known location,
nearest first. `location:nearest` → `buildNearestBoard()`
(`services/proximityService.ts`) answers it with **one** breadth-first search outward
from the target over the stargate graph — gate distance is symmetric, so ~90
characters cost one traversal, not ninety.

Two distances, because "closest" means two things in EVE:

- **Gate jumps** — how long the character takes to *fly* there. Null (shown "—") when
  no gate route exists at all: wormhole space has no stargates, and Pochven is its own
  disconnected component.
- **Light years** — straight-line distance, the unit every capital jump range is
  quoted in: whether a capital could jump to the character *where it already sits*.
  Two systems one light year apart can be forty gates apart, which is why the metric
  select re-ranks rather than just re-sorting a secondary column.

Rows carry the ship, docked location, account and how old the location is — a nearest
cyno alt on the same account as the ship that needs the cyno cannot fly it, so the
runners-up matter.

The **Tags** column shows only the tag the filter is set to, and "—" while it is on
"All tags". At 90 characters with several capabilities each, every other chip is noise
in a column whose job is confirming "yes, this one can do the thing"; the character's
full tag list stays one hover away as the cell's tooltip.

#### Jump clones ("Jump clones" checkbox)

Ticking it measures each character's **jump clones** as well as its current position,
so a character with a clone two jumps out ranks above one that has to fly thirty.
Opt-in because it costs work the plain ranking doesn't: ESI gives a clone a station or
structure id, never a system, so NPC stations resolve through public
`/universe/stations` (ESI-cached) and player structures through the `structures`
table. Clones in a citadel MCO hasn't resolved yet are **counted, not dropped**
(`unmeasuredClones` → the "clones unresolved" chip), because an unresolved citadel
could be the nearest thing there is; running "Import structures" fixes it.

- The service returns each character's clones alongside its own distance —
  `entry.jumps` always means "from where this character is". Choosing between them is
  `bestRoute()` in `renderer/src/lib/nearestView.ts`, which picks by **the metric being
  ranked** (a clone nearer by gates is often not the one nearer in light years) and
  keeps the character in place on a tie, since a clone jump costs it its ship and its
  cooldown.
- The **Via** column names the winning clone, its system, and the clone-jump cooldown
  (`nextCloneJumpDate` from `clones/jumpCooldown.ts` — 24h less one hour per level of
  Infomorph Synchronizing), shown as the same blue `chip--fatigue` timer the Clones
  page uses. A clone that beats every other route is only an *answer* once that timer
  is up; until then it is a plan, which is why the time is on the row rather than the
  clone being hidden or silently ranked down.
- The caveat the column header states: a clone jump **arrives in a pod**. It only
  helps where a cyno ship is already stationed — MCO doesn't track assets, so it
  cannot check that for you.

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
  digits 1–5; junk lines are skipped). Parser: `plans/parse.ts`. Plans can also be
  **built** rather than pasted — see the plan creator below.
- Analysis (`services/planService.ts`): resolves skills, expands prerequisites, and per
  character reports `complete` / `spGap` / `lsiGap` / `timeGapMinutes` /
  `missingSkills` — literally `analyzeFit` with `canFly` renamed (`plans/analyze.ts`).
- The same three cost systems (SP / Injectors / Time) and per-plan thresholds as fits;
  the system chosen on a plan's detail page also decides how that plan's gap reads on
  group objective bars and the character sheet (SP fallback when time is unknown).
- Per-character plan progress on the character sheet is computed by also analyzing a
  synthetic zero-skill character: its gap is the plan's total from-zero SP cost, and
  `1 - myGap/totalCost` is the progress fraction — same math both sides, no drift.
- **Which plans reach the character sheets is per plan.** Each plan carries an *On
  character sheets* toggle (the Plans table column, and the plan detail toolbar); with
  it off the plan is skipped before analysis, so it costs neither a row nor a
  prerequisite expansion on any sheet. A roster this size collects plans that only ever
  concern a few characters — one supercapital path, a retired doctrine — and a sheet
  listing all of them buries the ones being trained. The plan is untouched otherwise:
  its detail page still analyses the whole roster, and a group priority still points at
  it. New plans default to shown.
- Result buckets support the same right-click tag/group assignment as fits, and the
  "Plan complete" section carries the same **+ Assign tag** bulk control (`BulkTagBar`).

## Plan creator (`/plans/new`, `/plans/:id/edit`, `pages/PlanCreator.tsx`)

Where a plan is written, rather than pasted in from somewhere else. Reached from
**Create plan…** on the Plans page, or **Edit** on any plan (list row or detail page).

The screen is split: the **training queue** being built on the left, **every skill in
the game** on the right, each pane scrolling its own list.

- **One row per level.** The queue is what a plan actually trains — `Gunnery I`,
  `Gunnery II`, … — not a target level per skill. A row only costs the step it adds,
  so a queue that walks a skill I→V totals exactly what holding V costs.
- **The skill browser** (right) lists every published skill (SDE category 16)
  collapsed by SDE skill group, with a filter over group and skill names. Each skill
  carries **−** and **+**: `+` queues the next level (with anything it needs first),
  `−` drops the top one. The level currently queued is shown beside each skill, and
  skills already in the plan are tinted.
- **Attributes are stated once per group.** The group header carries the
  primary/secondary pair the majority of its skills train against
  (`groupSkills` picks it, ties broken alphabetically so it never depends on row
  order); only the skills that break that pair repeat it — Heavy Assault Cruisers
  showing `Wil/Per` inside a `Per/Wil` group. The queue on the left keeps its own
  Pri/Sec columns per row.
- **Prerequisites come with the level that needs them**, transitively, ahead of it —
  so a draft is in trainable order as it is built, and levels already queued are
  never restated.
- **Ship Browser** (`components/ShipBrowser.tsx`): a dialog over every published hull
  (SDE category 6 — 415 ships in 47 groups), searchable by name or browsable by ship
  group, each hull shown with its icon (`components/TypeIcon.tsx`, from the EVE image
  server the portraits already come from — lazy-loaded, and it holds the row's space
  rather than breaking when offline). Picking one queues every skill that flies it,
  prerequisites and levels included, and offers the hull's name as the plan name. The
  catalogue carries each hull's requirements with it (`plans:shipCatalog`, ~700 rows),
  so a pick costs no round-trip.
- **Add a fit's skills**: pick a saved fit, or paste EFT without saving one
  (`plans:draftFromFit` / `plans:draftFromEft` → `eftSkillRequirements`, the same
  "what counts toward flying this" rule the fit analysis uses). The fit's *direct*
  requirements come back; the creator expands them into levels and threads the
  prerequisites in. Merging into a non-empty draft only adds what isn't already there.
- **Training time.** Every row is priced in time as well as SP, with a running "done
  at" column, and the pane header totals both. Time is estimated at the attributes
  in the **Attributes** button — a plan is written for a character who will often
  remap before training it, so this is a setting, not synced data. It starts at an
  even remap (20/20/20/20/19 — 17 base plus 14 points, spare point off charisma) and
  is editable per attribute, persisted in localStorage (`lib/planAttributes.ts`).
- **Optimize attributes** (`optimizeAttributes`) rearranges the points already set
  into the fastest arrangement *for this plan*. It keeps the total rather than
  raising it, and stays inside the window that total implies (`remapWindow`: EVE's
  17–27 remap range, slid up by whatever the total says the implants are worth — so
  a +5-implant character is optimised as 22–32, not handed free points). The plan
  collapses to a handful of attribute-pair SP buckets and every legal arrangement in
  the 11-wide window is evaluated, so the answer is exact, not a heuristic; ties keep
  the arrangement closest to the current one. A unit test brute-forces the whole
  legal space to confirm nothing beats it.
- **The two panes are linked**: clicking a queued level — anywhere on the row, not
  just the name — opens that skill's group in the browser, scrolls to it and marks it
  briefly, so its − / + are to hand. A filter that already shows the skill is kept;
  one that would hide it is cleared, since an open group the filter excludes shows
  nothing.
- **Reordering**: drag a row **by its grip**, or use its ↑/↓ buttons. Only the grip
  arms `draggable`: with the whole row draggable, a click that drifted more than a
  few pixels started a drag instead, and Chromium fires no click after a drag — which
  made the click-to-reveal above work only sometimes. **Fix training order**
  topologically sorts the queue (prerequisites first, lower levels before higher) and
  is stable, so a hand-arranged order survives it.
- **Per-row notes** (`draftIssues`): `order` (queued before something it needs — the
  only one styled as a warning), `covered` (an earlier row already reaches this
  level), `prereq` (needs something this plan never trains — routine, since the
  character may already have it), `unknown` (a name no SDE skill matched).
- **Export**: *Copy to clipboard* writes the same `Skill Name V` lines that MCO's
  parser and EVE's own skill-plan import both accept (via Electron's clipboard —
  `system:copyText` — since the renderer is sandboxed and packaged builds load from
  `file://`). *Save* creates a plan, or updates the edited one **in place** so group
  priorities and character-sheet cards keep pointing at it; *Save as new* forks it.
- Opening a plan expands its lines into the per-level queue in place, preserving the
  author's order (`expandLevels`). It is lossless: a line whose name matches no skill
  is kept exactly as written (with `—` for its unknown data) rather than dropped.
- The whole draft is pure renderer logic (`lib/planDraft.ts`, unit-tested in
  `tests/unit/planDraft.test.ts`). The main process hands over the skill catalogue
  once (`plans:skillCatalog` — ~600 skills with group, rank, attributes, per-level SP
  and prerequisites), so browsing, filtering, adding, reordering and re-costing cost
  no further IPC. Per-level SP comes from main so EVE's SP formula stays in one place
  (`fits/analyze.ts`), and the SP/minute rule is shared outright
  (`shared/training.ts`) with the roster-wide analysis.

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

## Blueprints (`/blueprints`, `pages/Blueprints.tsx`)

A **BPO checklist**: every blueprint the game has, with the ones you own ticked off.
Built by `buildBlueprintBoard()` (`services/blueprintService.ts`), which joins the SDE's
blueprint universe (`sde_blueprints` + `sde_types`) against every original held by a
character or a tracked alt corp. The counting rules live in `blueprints/ownership.ts`
(pure, unit-tested).

**What counts as a blueprint that exists.** The default denominator is *market-seeded*
blueprints — published blueprint types that have a `marketGroupID`, ~1,879 in the pinned
SDE. That is the set that genuinely exists as originals: it includes the legacy Tech II
BPOs (Wolf, Crow, Raptor — the 50 bn ones from the original lottery) and Upwell structure
BPOs, and excludes invention-only Tech II/III and faction blueprints that only ever drop
as copies. Those are still in the table behind the **Include copy-only** toggle
(~4,166 published blueprints total), for looking something up rather than for scoring.

**What counts as owned.** The **Own** column is the checklist tick: a green ✓ means you
hold an original (`×N` when you hold several). Only originals earn one — ESI reports
copies through the same endpoint, and `quantity === -1` is the only thing that
distinguishes them — so a stack of BPCs leaves the row blank, with a `+Nc` suffix beside
the tick for context. The **Originals only** checkbox (on by default) is what enforces
that; turning it off ticks copies-only blueprints in muted grey and counts them, for the
"what could I actually build right now" reading. `isOwned` in `lib/blueprintView.ts` is
the single rule behind the tick, the owned/missing filter and the header count, so those
three can never contradict each other.

Items are deduped by `item_id`, because a blueprint moved into the corp hangar sits in
both tables until the character it left next syncs. Held originals whose blueprint type
is no longer published (old POS arrays, say) are counted as **off-catalog** rather than
invented as rows.

`BlueprintTotals` from the main process deliberately carries no "owned" number — that
answer depends on the two checkboxes, so it is counted in the renderer (`countOwned`)
where they live, rather than shipped as a figure that could disagree with the table.

Rows carry the best ME/TE across the originals held, and who holds each one — character
name, or an accent-bordered chip for an alt corp. Filters: search (name, group, holder),
category, owned/missing, **Originals only**, **Include copy-only**; every column sorts
(sorting by Own puts originals first and uses copies only as a tie-break, so a pile of
BPCs never floats above a blueprint you actually hold).

### Alt corps (the reason this feature needs a corporation scope)

Most of a serious collection lives in an **alt corp** — a corporation wholly controlled
by one player, used as a shared hangar — where no character token can see it.
"Track alt corp" runs SSO for one character with `esi-corporations.read_blueprints.v1`
added to the normal grant (see [Opt-in scopes](esi.md#opt-in-scopes)); that character
becomes the corp's **reader** and is the only token used for it. Nothing else about the
corporation is read — no assets, wallet, members or structures.

ESI serves the route only to a **Director**, and answers 403 otherwise. That is checked
immediately on adding the corp, so the reason appears while the user is still looking at
the dialog; it is then stored (`blueprint_corps.last_error`) and shown on the corp card
rather than retried every sweep.

The **Sources** panel is what keeps the number honest: the corp cards, plus any
characters whose token cannot report blueprints (`scope-missing` — tokens predating the
scope — or `login-expired`). The header chip turns warn-coloured whenever the fleet is
not fully reporting, because a checklist quietly missing a third of the roster is worse
than no checklist.

## Notifications

- **Detection** (`notifications/queueDrain.ts`, pure): a character whose *pending* skill
  queue has exactly one entry (nothing queued behind the training skill) finishing within
  **3 days** is about to waste training time.
- **Rule → sentences** (`services/notificationService.ts`), after each scheduler sweep:
  gathers candidates from the DB, hands them to the pure rule, and turns each warning
  into a title/body plus a dedupe key (`queue-drain:<charId>:<finishDate>`, so a
  re-queued skill earns a fresh warning while a repeated sweep does not).
- **Delivery** (`services/notificationDelivery.ts`): the half every kind shares —
  dedupe-keyed insert into the `notifications` table, one `notifications:changed` push
  to the renderer per batch, and an OS toast for each notification that was actually new
  (clicking it marks read + opens the window, creating one if the app is tray-only).
- **UI** (`components/NotificationBell.tsx`): sidebar bell with unread badge,
  mark-read/mark-all-read.
- A second kind (fatigue expired, extraction ready, plan complete) is a pure rule module
  beside `queueDrain.ts`, the reads that feed it, and the sentence it produces —
  `deliverNotifications` is already the shared half and does not change.

## Settings (`/settings`, `pages/Settings.tsx`)

Opened via the gear button at the bottom of the sidebar (next to the notification
bell). Seven sections:

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
- **Background sync** (`services/backgroundMode.ts`): keeps the hourly sweep running
  with the window closed, without relaunching as `MCO.exe --background`. A checkbox
  ("Keep syncing in the tray when I close the window", persisted in `app_settings`, so
  the main process can read it with no renderer alive) plus "Run in background now",
  which raises the tray and closes the window immediately. Disabled when the process
  was launched with `--background` — that one always lives in the tray. See
  [architecture.md](architecture.md#launch-modes--lifecycle-srcmainindexts).
- **Appearance**: theme picker. Themes are CSS custom-property override blocks in
  `styles.css` keyed off `data-theme` on `<html>` (`dark` default, `holo` — a sci-fi
  cyan HUD look with theme-scoped glow rules, `light`, `void`, `amber`). Definitions
  live in `lib/theme.ts` (pure); applying/persisting in `renderer/src/theme.ts` — the
  choice is stored in `localStorage` and applied in `main.tsx` before first render,
  so no theme flash.
  Holo is the one theme that restyles `button` itself, and `:not()` carries its
  argument's specificity, so that rule outranks anything a button class declares.
  Buttons that are really text — a clickable row, a menu item, a tab, a chip's ✕ —
  therefore have to be excluded there or they come out as filled cyan controls.
  **`.plain` is the marker for new ones**; the classes listed beside it predate it.
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
  (version/runtime/platform/DB header + the session log) via a save dialog. If the
  main process crashes there is no Settings page left to click, so `main/fatal.ts`
  writes that same diagnostics file itself — `mco-crash-<stamp>.txt` in the profile
  folder — and the dialog before exit names the path (see
  [architecture.md](architecture.md#crash-handling-srcmainfatalts)).
- **Backup**: "Back up database…" writes a consistent snapshot via better-sqlite3's
  online backup API (WAL-safe, app keeps running) to a user-chosen path; restore =
  quit MCO and copy the file back over `mco.sqlite`. Refresh tokens are
  `safeStorage`-encrypted per OS user, so a backup restored on a different
  machine/user keeps all data but characters must be re-added. "Open data folder"
  opens the profile directory.
- **About**: version/runtime facts plus GitHub repository and issue-tracker links
  (opened externally via the window-open handler), and the update check —
  "Check for updates" plus a line on what the last check found, and the switch for
  whether MCO checks on its own. Turning that off silences the update banner; the
  button here still works. It is the same switch the banner asks a new profile for on
  first launch, and it is hidden in a build that never checks anyway.

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
