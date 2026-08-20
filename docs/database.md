# Database

MCO stores everything in a single SQLite file, `mco.sqlite`, in Electron's `userData`
directory, accessed synchronously via **better-sqlite3** from the main process only.

## Connection (`src/main/db/index.ts`)

Opened once at startup (before any IPC handler can fire) with:

```
journal_mode = WAL      -- readers don't block the hourly sync writes
foreign_keys = ON       -- ON DELETE CASCADE actually fires
synchronous  = NORMAL
```

`better-sqlite3` ships a native `.node` binary, so it is externalized from the Vite
bundle (`electron.vite.config.ts`) and unpacked from the asar archive when packaging
(`electron-builder.yml` → `asarUnpack`).

## Migrations (`src/main/db/migrations.ts`)

Plain sequential SQL migrations, tracked in `schema_migrations`. Each migration runs in
its own transaction. Rules:

- **Never edit an applied migration** — append a new one with the next version number.
- **Keep the array in ascending order.** `LATEST_SCHEMA_VERSION` reads its last element,
  and the downgrade guard below trusts that. Unit tests enforce it.
- `LATEST_SCHEMA_VERSION` is derived from the array; nothing else to bump.
- Repositories assume the latest schema; there is no down-migration.

**Opening a newer profile fails at startup, by design.** There is no down-migration, so a
database whose highest applied version exceeds this build's is unreadable — it may hold
tables this code has never heard of. `runMigrations` would not notice on its own (nothing
is pending), and the damage would show up as a stray SQL error at the first query against a
changed table. Instead `schemaDowngradeMessage` compares the two versions, `runMigrations`
throws `SchemaVersionError`, and `src/main/index.ts` turns that into a dialog and quits.
The profile's version is shown in Settings → About.

| v | Name | Adds |
| - | --- | --- |
| 1 | init | `accounts`, `characters`, `tokens`, `character_skills`, `skill_queue`, `esi_cache`, `sde_version` |
| 2 | sde_tables | `sde_categories`, `sde_groups`, `sde_types` |
| 3 | fit_testing | `sde_type_skill_reqs`, `sde_skill_ranks`, `fits` |
| 4 | location_tracking | `sde_regions`, `sde_systems`, `character_location` |
| 5 | skill_plans | `skill_plans` |
| 6 | notifications | `notifications` |
| 7 | clone_tracking | `character_implants`, `character_clones`, `character_clone_implants`, `character_clones_meta` |
| 8 | token_health | `tokens.invalid_at` |
| 9 | character_groups | `character_groups`, `character_group_members` |
| 10 | tags | `tags`, `character_tags` |
| 11 | jump_fatigue | `character_fatigue` |
| 12 | group_priorities | `character_groups.priority_fit_id/.priority_plan_id/.home_station_id/.home_station_name` |
| 13 | wallet | `character_wallet` |
| 14 | clone_jump_cooldown | `character_clones_meta.last_clone_jump_date` |
| 15 | account_omega | `accounts.is_omega` |
| 16 | medical_clone | `character_clones_meta.home_location_id/.home_location_type` |
| 17 | structures | `structures` |
| 18 | group_pod_systems | `group_pod_systems` |
| 19 | group_pod_ignores | `group_pod_ignores` |
| 20 | character_attributes | `character_attributes` |
| 21 | sde_skill_attributes | `sde_skill_attributes` |
| 22 | character_online | `character_online` |
| 23 | character_wallet_journal | `character_wallet_journal` |
| 24 | app_settings | `app_settings` |
| 25 | sde_types_market_meta | `sde_types.market_group_id/.meta_group_id` |
| 26 | sde_blueprints | `sde_blueprints` |
| 27 | character_blueprints | `character_blueprints`, `character_blueprints_meta` |
| 28 | blueprint_corps | `blueprint_corps`, `corporation_blueprints` |
| 29 | esi_cache_pages | `esi_cache.pages` (drops cached paginated entries) |
| 30 | character_wallet_journal_parties | `character_wallet_journal.tax/.first_party_id/.second_party_id` |
| 31 | sde_system_jumps | `sde_system_jumps`, `sde_systems.pos_x/.pos_y/.pos_z` |
| 32 | plan_sheet_visibility | `skill_plans.show_on_character_sheet` |

## Schema reference

### Identity & auth

- **`accounts`** — user-created account buckets (`label`, `color`, `is_omega`). ESI
  cannot reveal real account membership (or Omega status), so this is manual
  bookkeeping; `is_omega` feeds the "Omega account training nobody" warning.
- **`characters`** — `id` is the EVE character id (primary key, not autoincrement).
  `account_id` → `accounts` (`ON DELETE SET NULL` — deleting an account never deletes
  characters). `refreshed_at` = last successful sync.
- **`tokens`** — one row per character (`ON DELETE CASCADE`).
  `refresh_token_encrypted` (BLOB, safeStorage-encrypted), `scopes` (space-separated
  grant recorded at login), cached `access_token` + `access_expires_at`, and
  `invalid_at` (set when SSO rejects the refresh token → "login expired" UI state).

### Character state (from ESI)

- **`character_skills`** — (character, skill_type_id) → sp, trained_level, active_level.
  Fully replaced on each sync.
- **`skill_queue`** — (character, position) → skill, finish_level, start/finish dates.
  Fully replaced on each sync. Position 0 with a future finish date = currently training.
- **`character_location`** — one row per character: last-known solar system,
  station/structure (docked when either is set), current ship type + name, `updated_at`.
- **`character_implants`** — implants in the *active* clone.
- **`character_clones`** / **`character_clone_implants`** — jump clones (id, custom
  name, location id/type) and their implants. Composite FK cascades clone deletion to
  its implants.
- **`character_clones_meta`** — `updated_at` per character; its presence is the
  "clone data has synced at least once" signal (drives `EsiDataStatus`). Also holds
  `last_clone_jump_date` (ESI's `last_clone_jump_date`), from which the next
  clone-jump availability is computed (`src/main/clones/jumpCooldown.ts`: 24h minus
  1h per Infomorph Synchronizing level), and the medical clone's
  `home_location_id`/`home_location_type` (ESI's `home_location`).
- **`character_fatigue`** — jump fatigue expiry + last jump date.
- **`character_wallet`** — wallet balance (ISK) + `updated_at`.
- **`character_attributes`** — the five neural attributes plus remap state
  (`bonus_remaps`, `last_remap_date`, `accrued_remap_cooldown_date` — nullable,
  ESI omits them for a never-remapped character).
- **`character_online`** — whether a character is currently logged into
  Tranquility (`online`, `last_login`, `last_logout`), scope-gated
  (`esi-location.read_online.v1`); feeds the Dashboard's "characters online" tile.
- **`character_wallet_journal`** — *not* a full journal mirror: only rows whose
  `ref_type` is a tracked category are stored — PvE income (`bounty_prizes`,
  `ess_escrow_transfer`, `agent_mission_reward`,
  `agent_mission_time_bonus_reward`), `corporate_reward_payout` (CONCORD paying
  out a completed site, not a corp project — and reported net of corp tax),
  `player_donation`, running costs (`skill_purchase`, `structure_gate_jump`,
  `planetary_construction`, `repair_bill`), and anything ending in `_tax` or
  `_fee` (matched by suffix, since ESI has ~17 tax types and as many fee types —
  though it emits tax rows far more rarely than the in-game journal shows them). Keyed by `(character_id, journal_id)` so repeated syncs
  dedupe for free (journal ids are immutable); the upsert refreshes `tax` and the
  party ids on conflict, which backfills rows written before migration 30.
  `tax` is tax withheld at source (a taxed bounty's `amount` is already net of
  it) and `first_party_id`/`second_party_id` are what tell a donation between two
  tracked characters apart from outside income. Feeds the Dashboard's "Income"
  tile and every Wallet card (`sumWalletTotalsBetween` /
  `sumWalletTotalsByMonth` in `db/repositories/characterWalletJournal.ts`);
  indexed on `occurred_at` for the calendar-month range scan. **The table is the
  archive** — ESI's journal reaches ~30 days back, so nothing prunes it: the
  Wallet page's previous-months view is exactly what past syncs banked.
- **`character_blueprints`** — blueprints in a character's own hangars, keyed by
  ESI's `item_id` (unique game-wide, so it is the natural key and a blueprint
  handed to another character replaces its stale row rather than duplicating).
  `quantity` is the field that matters: **-1 = original**, -2 = a copy, positive
  = a stack of copies. Scope-gated (`esi-characters.read_blueprints.v1`).
  **`character_blueprints_meta`** records that a character has reported at all —
  a character owning zero blueprints is otherwise indistinguishable from one
  that never synced.
- **`blueprint_corps`** + **`corporation_blueprints`** — alt-corp blueprint
  hangars. A corporation appears only if the user added it explicitly, by
  signing a character in with the opt-in `esi-corporations.read_blueprints.v1`
  scope; that character is stored as `reader_character_id` and is the only token
  ever used for the corp, so one tracked corp costs one request per ESI cache
  window however many characters are in it. `last_error`/`last_error_at` hold
  why a read failed (almost always: the reader is not a Director) so the page
  can explain it and sweeps can back off instead of re-spending an error-limit
  slot every hour. Both cascade from `characters(id)` — losing the reader
  removes the corp and its blueprints, which is honest, since nothing could read
  it any more.
- **`structures`** — player-owned (Upwell) structures referenced by character
  locations and clones, keyed by `structure_id`: `name`, `solar_system_id`,
  `type_id`, `owner_id` (corporation). **Shared, not per-character** — once any
  token resolves a citadel, every page shows its name. A row with a NULL `name`
  is a known id nobody has resolved yet. `resolved_at`/`failed_at` (ISO
  timestamps, written by JS not `datetime('now')`) drive the refresh policy in
  `src/main/structures/refreshPolicy.ts`: resolved rows refresh weekly, failed
  lookups (403 — no docking access) retry daily, keeping any stale name.

Sync writes use a replace-all-rows-in-a-transaction pattern (`replaceSkills`,
`replaceQueue`, `replaceJumpClones`, …) — simple and idempotent.

### User organization

- **`character_groups`** + **`character_group_members`** — optional, many-to-many
  organizational units ("WH defense"). A group may carry a `priority_fit_id` →
  `fits` and/or `priority_plan_id` → `skill_plans` (both `ON DELETE SET NULL`) — the
  objective its members train toward, shown as progress bars on the group page.
  `home_station_id`/`home_station_name` hold the group's home station (a structure
  picked via search on the group page); member cards flag medical clones parked
  elsewhere. The name is denormalized so display survives losing ACL access later.
- **`group_pod_systems`** — per-group whitelist of solar systems
  (`solar_system_id` + denormalized `system_name`, picked via SDE search) where
  members' pods carrying implants are allowed to sit. The group page lists every
  implanted pod (active body or jump clone) outside these systems. Empty = check off.
- **`group_pod_ignores`** — pods exempted from that check ("Ignore" on the group
  page). `jump_clone_id` is the ESI id of the ignored jump clone, or `0` for the
  character's active pod. Per group: the same clone can be ignored for one group and
  still flagged for another. Rows survive the clone (managed on the Ignored tab) but
  cascade away with their group or character.
- **`tags`** + **`character_tags`** — character *capabilities* ("Is able to Cyno").
  Tag names are unique case-insensitively (`idx_tags_name` on `name COLLATE NOCASE`).
  See the Organization model section of [CLAUDE.md](../CLAUDE.md#organization-model) for
  why groups and tags are deliberately separate concepts.

### Content the user imports

- **`fits`** — EFT text blobs plus parsed ship name and (when the SDE resolves it)
  `ship_type_id`. Fits are re-parsed on every analysis; the DB stores the source text.
- **`skill_plans`** — plan name + raw plan text; also re-parsed on demand.
  `show_on_character_sheet` (default 1) is the only per-plan setting: with it off the
  plan is skipped by `listPlanProgressForCharacter`, so it neither costs an analysis
  nor takes a row on any character sheet. Nothing else reads it — the plan keeps its
  detail page, its list row and any group priority pointing at it.

### Caches & infrastructure

- **`esi_cache`** — url → etag, expires_at, body, pages. The heart of ESI politeness: fresh
  entries short-circuit HTTP entirely; expired ones revalidate with `If-None-Match`.
  `pages` is the response's `X-Pages` (null off paginated routes), stored because a fresh
  hit skips the request that would otherwise carry it — `esiGetPaged` reads the page count
  from cache and from the wire alike.
- **`notifications`** — in-app notification feed. `dedupe_key` (UNIQUE) is what makes
  "notify once per distinct occurrence" work, e.g. `queue-drain:<charId>:<finishDate>`.
- **`sde_version`** — single row (id=1): imported SDE build number + timestamp.
- **`app_settings`** — key/value store for preferences the *main* process owns, i.e. ones
  it must read with no renderer around (`close_to_tray`, `tray_notice_shown` — see
  [architecture.md](architecture.md#launch-modes--lifecycle-srcmainindexts)) plus the
  update and SDE check state (`update.lastCheck`, `update.dismissedVersion`,
  `update.autoCheck`, `sde.lastCheck`, `sde.dismissedBuild`). Booleans are
  `'1'`/`'0'`; a missing key reads as the caller's fallback, so nothing needs seeding.
  `update.autoCheck` leans on that: absent means "this profile has never been asked
  whether to check for releases", which is a third state and not a default.
  Renderer-only view state (theme, demo mode, collapsed sections) stays in localStorage.

### SDE tables (filled by the import pipeline, see [sde.md](sde.md))

- **`sde_categories`** / **`sde_groups`** / **`sde_types`** — the item-type tree.
  `sde_types.name` is indexed for the case-insensitive name→id resolution used by
  EFT/plan imports. `market_group_id` and `meta_group_id` (added in v25) are what
  the blueprint checklist reads: a blueprint *with* a market group is one that
  exists as an original, and the product's meta group gives its tech tier.
- **`sde_blueprints`** — blueprint type → what one run makes
  (`product_type_id`), `activity` (`manufacturing` / `reaction` / `other`) and
  `max_production_limit`. Blueprint types all sit in the "Blueprint" category
  themselves, so the checklist groups by the **product's** group/category.
  Non-empty ⇒ `hasBlueprintData`; empty on upgraded installs until an SDE
  re-import.
- **`sde_type_skill_reqs`** — type → required skill + level (from typeDogma). Powers
  both fit analysis and plan prerequisite closure. Non-empty ⇒ `hasSkillData`.
- **`sde_skill_ranks`** — skill → rank (skillTimeConstant), the SP-per-level multiplier.
- **`sde_skill_attributes`** — skill → primary/secondary training attribute ids (dogma
  180/181; the values are attribute ids 164–168). Powers the training-time cost metric.
  Non-empty ⇒ `hasSkillAttributes`; empty on upgraded installs until an SDE re-import.
- **`sde_regions`** / **`sde_systems`** — map data (system name, region, security,
  and since v31 the system's position in metres, `pos_x/pos_y/pos_z`, which the
  light-year distances are measured from). Non-empty `sde_systems` ⇒ `hasMapData`;
  positions are nullable, so a map imported before v31 reads as unknown rather than
  as coordinates (0,0,0).
- **`sde_system_jumps`** — one row per stargate, `from_system_id` → `to_system_id`.
  The map as a graph: read whole and made undirected in memory (`main/map/routing.ts`)
  for the breadth-first search behind "who is nearest to this system". Non-empty ⇒
  `hasJumpData`; empty on upgraded installs until an SDE re-import.

## Repository layer

`src/main/db/repositories/` — one module per aggregate, the only code allowed to write
SQL. Conventions:

- snake_case in SQL, camelCase in TypeScript; each repo maps rows at the boundary.
- Batch lookups take `number[]` and return `Map`s (`getTypeNames`, `getSystems`,
  `getSkillRanks`) so services can resolve names in one query per table.
- Multi-row writes are wrapped in `db.transaction(...)`.
