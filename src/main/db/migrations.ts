import type { Database } from 'better-sqlite3';

interface Migration {
  version: number;
  name: string;
  sql: string;
}

/**
 * Append-only: never edit an entry once it has shipped, and keep versions in
 * ascending order — `LATEST_SCHEMA_VERSION` reads the last element, and the
 * open-time downgrade guard is only as correct as that.
 */
export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'init',
    sql: `
      CREATE TABLE accounts (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        label     TEXT NOT NULL,
        color     TEXT
      );

      CREATE TABLE characters (
        id          INTEGER PRIMARY KEY,
        name        TEXT NOT NULL,
        corp_id     INTEGER,
        alliance_id INTEGER,
        account_id  INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
        added_at    TEXT NOT NULL DEFAULT (datetime('now')),
        refreshed_at TEXT
      );

      CREATE TABLE tokens (
        character_id            INTEGER PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
        refresh_token_encrypted BLOB NOT NULL,
        scopes                  TEXT NOT NULL,
        access_token            TEXT,
        access_expires_at       TEXT
      );

      CREATE TABLE character_skills (
        character_id  INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
        skill_type_id INTEGER NOT NULL,
        sp            INTEGER NOT NULL DEFAULT 0,
        trained_level INTEGER NOT NULL DEFAULT 0,
        active_level  INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (character_id, skill_type_id)
      );

      CREATE TABLE skill_queue (
        character_id  INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
        position      INTEGER NOT NULL,
        skill_type_id INTEGER NOT NULL,
        finish_level  INTEGER NOT NULL,
        start_date    TEXT,
        finish_date   TEXT,
        PRIMARY KEY (character_id, position)
      );

      CREATE TABLE esi_cache (
        url        TEXT PRIMARY KEY,
        etag       TEXT,
        expires_at TEXT,
        body       TEXT NOT NULL,
        cached_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE sde_version (
        id          INTEGER PRIMARY KEY CHECK (id = 1),
        version     TEXT NOT NULL,
        imported_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `,
  },
  {
    version: 2,
    name: 'sde_tables',
    sql: `
      CREATE TABLE sde_categories (
        id        INTEGER PRIMARY KEY,
        name      TEXT NOT NULL,
        published INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE sde_groups (
        id          INTEGER PRIMARY KEY,
        category_id INTEGER NOT NULL,
        name        TEXT NOT NULL,
        published   INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE sde_types (
        id        INTEGER PRIMARY KEY,
        group_id  INTEGER NOT NULL,
        name      TEXT NOT NULL,
        published INTEGER NOT NULL DEFAULT 0
      );

      CREATE INDEX idx_sde_groups_category ON sde_groups(category_id);
      CREATE INDEX idx_sde_types_group ON sde_types(group_id);
      CREATE INDEX idx_sde_types_name ON sde_types(name);
    `,
  },
  {
    version: 3,
    name: 'fit_testing',
    sql: `
      CREATE TABLE sde_type_skill_reqs (
        type_id       INTEGER NOT NULL,
        skill_type_id INTEGER NOT NULL,
        level         INTEGER NOT NULL,
        PRIMARY KEY (type_id, skill_type_id)
      );

      CREATE TABLE sde_skill_ranks (
        skill_type_id INTEGER PRIMARY KEY,
        rank          REAL NOT NULL
      );

      CREATE TABLE fits (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        name         TEXT NOT NULL,
        ship_type_id INTEGER,
        ship_name    TEXT NOT NULL,
        eft_text     TEXT NOT NULL,
        imported_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `,
  },
  {
    version: 4,
    name: 'location_tracking',
    sql: `
      CREATE TABLE sde_regions (
        id   INTEGER PRIMARY KEY,
        name TEXT NOT NULL
      );

      CREATE TABLE sde_systems (
        id        INTEGER PRIMARY KEY,
        name      TEXT NOT NULL,
        region_id INTEGER NOT NULL,
        security  REAL NOT NULL
      );

      CREATE TABLE character_location (
        character_id    INTEGER PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
        solar_system_id INTEGER,
        station_id      INTEGER,
        structure_id    INTEGER,
        ship_type_id    INTEGER,
        ship_name       TEXT,
        updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX idx_sde_systems_region ON sde_systems(region_id);
    `,
  },
  {
    version: 5,
    name: 'skill_plans',
    sql: `
      CREATE TABLE skill_plans (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT NOT NULL,
        plan_text   TEXT NOT NULL,
        imported_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `,
  },
  {
    version: 6,
    name: 'notifications',
    sql: `
      CREATE TABLE notifications (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        kind         TEXT NOT NULL,
        dedupe_key   TEXT NOT NULL UNIQUE,
        character_id INTEGER REFERENCES characters(id) ON DELETE SET NULL,
        title        TEXT NOT NULL,
        body         TEXT NOT NULL,
        created_at   TEXT NOT NULL DEFAULT (datetime('now')),
        read_at      TEXT
      );

      CREATE INDEX idx_notifications_read ON notifications(read_at);
    `,
  },
  {
    version: 7,
    name: 'clone_tracking',
    sql: `
      CREATE TABLE character_implants (
        character_id    INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
        implant_type_id INTEGER NOT NULL,
        PRIMARY KEY (character_id, implant_type_id)
      );

      CREATE TABLE character_clones (
        character_id  INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
        jump_clone_id INTEGER NOT NULL,
        name          TEXT,
        location_id   INTEGER,
        location_type TEXT,
        PRIMARY KEY (character_id, jump_clone_id)
      );

      CREATE TABLE character_clone_implants (
        character_id    INTEGER NOT NULL,
        jump_clone_id   INTEGER NOT NULL,
        implant_type_id INTEGER NOT NULL,
        PRIMARY KEY (character_id, jump_clone_id, implant_type_id),
        FOREIGN KEY (character_id, jump_clone_id)
          REFERENCES character_clones(character_id, jump_clone_id) ON DELETE CASCADE
      );

      CREATE TABLE character_clones_meta (
        character_id INTEGER PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
        updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `,
  },
  {
    version: 8,
    name: 'token_health',
    sql: `
      ALTER TABLE tokens ADD COLUMN invalid_at TEXT;
    `,
  },
  {
    version: 9,
    name: 'character_groups',
    sql: `
      CREATE TABLE character_groups (
        id    INTEGER PRIMARY KEY AUTOINCREMENT,
        name  TEXT NOT NULL,
        color TEXT
      );

      CREATE TABLE character_group_members (
        group_id     INTEGER NOT NULL REFERENCES character_groups(id) ON DELETE CASCADE,
        character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
        PRIMARY KEY (group_id, character_id)
      );

      CREATE INDEX idx_cgm_character ON character_group_members(character_id);
    `,
  },
  {
    version: 10,
    name: 'tags',
    sql: `
      CREATE TABLE tags (
        id    INTEGER PRIMARY KEY AUTOINCREMENT,
        name  TEXT NOT NULL,
        color TEXT
      );

      CREATE UNIQUE INDEX idx_tags_name ON tags(name COLLATE NOCASE);

      CREATE TABLE character_tags (
        tag_id       INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
        PRIMARY KEY (tag_id, character_id)
      );

      CREATE INDEX idx_ct_character ON character_tags(character_id);
    `,
  },
  {
    version: 11,
    name: 'jump_fatigue',
    sql: `
      CREATE TABLE character_fatigue (
        character_id             INTEGER PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
        jump_fatigue_expire_date TEXT,
        last_jump_date           TEXT,
        updated_at               TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `,
  },
  {
    version: 12,
    name: 'group_priorities',
    sql: `
      ALTER TABLE character_groups ADD COLUMN priority_fit_id INTEGER REFERENCES fits(id) ON DELETE SET NULL;
      ALTER TABLE character_groups ADD COLUMN priority_plan_id INTEGER REFERENCES skill_plans(id) ON DELETE SET NULL;
      ALTER TABLE character_groups ADD COLUMN home_station_id INTEGER;
      ALTER TABLE character_groups ADD COLUMN home_station_name TEXT;
    `,
  },
  {
    version: 13,
    name: 'wallet',
    sql: `
      CREATE TABLE character_wallet (
        character_id INTEGER PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
        balance      REAL NOT NULL,
        updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `,
  },
  {
    version: 14,
    name: 'clone_jump_cooldown',
    sql: `
      ALTER TABLE character_clones_meta ADD COLUMN last_clone_jump_date TEXT;
    `,
  },
  {
    version: 15,
    name: 'account_omega',
    sql: `
      ALTER TABLE accounts ADD COLUMN is_omega INTEGER NOT NULL DEFAULT 0;
    `,
  },
  {
    version: 16,
    name: 'medical_clone',
    sql: `
      ALTER TABLE character_clones_meta ADD COLUMN home_location_id INTEGER;
      ALTER TABLE character_clones_meta ADD COLUMN home_location_type TEXT;
    `,
  },
  {
    // Player-owned (Upwell) structures referenced by character locations and
    // clones. Resolved via authed ESI per structure and shared app-wide: a row
    // with a NULL name is a known id nobody has resolved yet; failed_at throttles
    // retries for structures no token can dock at.
    version: 17,
    name: 'structures',
    sql: `
      CREATE TABLE structures (
        structure_id    INTEGER PRIMARY KEY,
        name            TEXT,
        solar_system_id INTEGER,
        type_id         INTEGER,
        owner_id        INTEGER,
        resolved_at     TEXT,
        failed_at       TEXT
      );
    `,
  },
  {
    // Per-group whitelist of solar systems where members' pods carrying
    // implants are allowed to sit; pods elsewhere are flagged on the group
    // page. system_name is denormalized from the SDE so display never needs
    // a lookup.
    version: 18,
    name: 'group_pod_systems',
    sql: `
      CREATE TABLE group_pod_systems (
        group_id        INTEGER NOT NULL REFERENCES character_groups(id) ON DELETE CASCADE,
        solar_system_id INTEGER NOT NULL,
        system_name     TEXT NOT NULL,
        PRIMARY KEY (group_id, solar_system_id)
      );
    `,
  },
  {
    // Pods the user chose to exempt from a group's pod-location whitelist
    // check ("Ignore" on the group page). jump_clone_id is the ESI id of the
    // ignored jump clone, or 0 for the character's active pod (ESI clone ids
    // are always positive). Ignoring is per group: the same clone can be
    // ignored for one group and still flagged for another.
    version: 19,
    name: 'group_pod_ignores',
    sql: `
      CREATE TABLE group_pod_ignores (
        group_id      INTEGER NOT NULL REFERENCES character_groups(id) ON DELETE CASCADE,
        character_id  INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
        jump_clone_id INTEGER NOT NULL,
        ignored_at    TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (group_id, character_id, jump_clone_id)
      );
    `,
  },
  {
    // Neural attributes + remap availability, shown on the character sheet.
    // Remap columns are nullable: ESI omits them for a never-remapped character.
    version: 20,
    name: 'character_attributes',
    sql: `
      CREATE TABLE character_attributes (
        character_id                INTEGER PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
        intelligence                INTEGER NOT NULL,
        memory                      INTEGER NOT NULL,
        charisma                    INTEGER NOT NULL,
        perception                  INTEGER NOT NULL,
        willpower                   INTEGER NOT NULL,
        bonus_remaps                INTEGER,
        last_remap_date             TEXT,
        accrued_remap_cooldown_date TEXT,
        updated_at                  TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `,
  },
  {
    // Per-skill training attributes (values of dogma attrs 180/181, which are
    // themselves attribute ids: 164 cha, 165 int, 166 mem, 167 per, 168 wil),
    // for the training-time cost metric. Empty on upgraded installs until the
    // SDE is re-imported; the Time metric reads as unknown meanwhile.
    version: 21,
    name: 'sde_skill_attributes',
    sql: `
      CREATE TABLE sde_skill_attributes (
        skill_type_id          INTEGER PRIMARY KEY,
        primary_attribute_id   INTEGER NOT NULL,
        secondary_attribute_id INTEGER NOT NULL
      );
    `,
  },
  {
    // Whether a character is currently logged into Tranquility, for the
    // Dashboard's "characters online" tile. Scope-gated
    // (esi-location.read_online.v1); rows only exist for characters whose
    // token has granted it and synced at least once.
    version: 22,
    name: 'character_online',
    sql: `
      CREATE TABLE character_online (
        character_id INTEGER PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
        online       INTEGER NOT NULL,
        last_login   TEXT,
        last_logout  TEXT,
        updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `,
  },
  {
    // A slice of each character's wallet journal, for the Dashboard's
    // "ratted ISK this month" tile. Not a full journal mirror — only rows
    // whose ref_type is one of the tracked PvE-income categories (NPC
    // bounty prizes, ESS reserve payouts, mission rewards) are stored, so
    // the table stays small. journal_id is ESI's immutable entry id;
    // (character_id, journal_id) dedupes across repeated syncs.
    version: 23,
    name: 'character_wallet_journal',
    sql: `
      CREATE TABLE character_wallet_journal (
        character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
        journal_id   INTEGER NOT NULL,
        ref_type     TEXT NOT NULL,
        amount       REAL NOT NULL,
        occurred_at  TEXT NOT NULL,
        PRIMARY KEY (character_id, journal_id)
      );

      CREATE INDEX idx_character_wallet_journal_occurred_at
        ON character_wallet_journal (occurred_at);
    `,
  },
  {
    // Key/value store for main-process preferences — settings the main process
    // must know without a renderer (the window may be closed, or never opened
    // in --background mode), so localStorage is not an option. Renderer-only
    // view state (collapsed sections, theme, column choices) stays in
    // localStorage; this table is for behaviour the main process owns.
    version: 24,
    name: 'app_settings',
    sql: `
      CREATE TABLE app_settings (
        key        TEXT PRIMARY KEY,
        value      TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `,
  },
  {
    // Market group and meta group per type, for the blueprint checklist.
    // A blueprint's market group is what separates the ones that exist as
    // originals (seeded on the market at some point — including the legacy
    // Tech II BPOs) from the invention/drop-only types that only ever exist as
    // copies. Null on upgraded installs until the SDE is re-imported; the
    // checklist reads as unavailable meanwhile (`hasBlueprintData`).
    version: 25,
    name: 'sde_types_market_meta',
    sql: `
      ALTER TABLE sde_types ADD COLUMN market_group_id INTEGER;
      ALTER TABLE sde_types ADD COLUMN meta_group_id INTEGER;
    `,
  },
  {
    // Every blueprint (and reaction formula) in the SDE, with what it makes.
    // The product is what gives a blueprint its category — blueprint types are
    // all in the "Blueprint" category themselves, so grouping the checklist by
    // Ships / Modules / Charges means grouping by the *product's* group.
    version: 26,
    name: 'sde_blueprints',
    sql: `
      CREATE TABLE sde_blueprints (
        blueprint_type_id    INTEGER PRIMARY KEY,
        product_type_id      INTEGER,
        activity             TEXT NOT NULL,
        max_production_limit INTEGER
      );

      CREATE INDEX idx_sde_blueprints_product ON sde_blueprints (product_type_id);
    `,
  },
  {
    // Blueprints held in a character's own hangars (esi-characters.read_blueprints.v1).
    // item_id is ESI's unique item id, so it is the natural key; rows are
    // replaced wholesale per character on each sync. The companion meta table
    // records that a character has reported at all — a character owning zero
    // blueprints is otherwise indistinguishable from one that never synced.
    version: 27,
    name: 'character_blueprints',
    sql: `
      CREATE TABLE character_blueprints (
        item_id             INTEGER PRIMARY KEY,
        character_id        INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
        type_id             INTEGER NOT NULL,
        quantity            INTEGER NOT NULL,
        runs                INTEGER NOT NULL,
        material_efficiency INTEGER NOT NULL,
        time_efficiency     INTEGER NOT NULL,
        location_id         INTEGER NOT NULL,
        location_flag       TEXT NOT NULL
      );

      CREATE INDEX idx_character_blueprints_character ON character_blueprints (character_id);
      CREATE INDEX idx_character_blueprints_type ON character_blueprints (type_id);

      CREATE TABLE character_blueprints_meta (
        character_id INTEGER PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
        updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `,
  },
  {
    // Alt-corp blueprint hangars. A corporation is tracked only if the user
    // explicitly adds it, by signing a character in with the opt-in
    // esi-corporations.read_blueprints.v1 scope; that character is the corp's
    // reader and the only token used for it, so one tracked corp costs one
    // request per ESI cache window no matter how many characters are in it.
    // ESI answers 403 unless the reader holds the Director role — that reason
    // is kept in last_error so the page can explain it instead of retrying.
    version: 28,
    name: 'blueprint_corps',
    sql: `
      CREATE TABLE blueprint_corps (
        corporation_id      INTEGER PRIMARY KEY,
        name                TEXT,
        ticker              TEXT,
        reader_character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
        added_at            TEXT NOT NULL DEFAULT (datetime('now')),
        synced_at           TEXT,
        last_error          TEXT,
        last_error_at       TEXT
      );

      CREATE TABLE corporation_blueprints (
        item_id             INTEGER PRIMARY KEY,
        corporation_id      INTEGER NOT NULL REFERENCES blueprint_corps(corporation_id) ON DELETE CASCADE,
        type_id             INTEGER NOT NULL,
        quantity            INTEGER NOT NULL,
        runs                INTEGER NOT NULL,
        material_efficiency INTEGER NOT NULL,
        time_efficiency     INTEGER NOT NULL,
        location_id         INTEGER NOT NULL,
        location_flag       TEXT NOT NULL
      );

      CREATE INDEX idx_corporation_blueprints_corp ON corporation_blueprints (corporation_id);
      CREATE INDEX idx_corporation_blueprints_type ON corporation_blueprints (type_id);
    `,
  },
  {
    // X-Pages has to outlive the response that carried it: a paged read whose
    // first page is served from a still-fresh cache entry has no headers to
    // read the page count from, and treating that as "one page" would truncate
    // the result — which, for blueprints, deletes the rows the missing pages
    // would have carried. Entries cached before this column existed would read
    // as exactly that NULL, so drop the paginated ones; the cache is disposable
    // by design and refills on the next sync.
    version: 29,
    name: 'esi_cache_pages',
    sql: `
      ALTER TABLE esi_cache ADD COLUMN pages INTEGER;

      DELETE FROM esi_cache WHERE url LIKE '%page=%';
    `,
  },
  {
    // The Wallet page grew past ratting income (corp reward payouts, tax paid,
    // player donations), and two of those need fields the journal slice never
    // stored:
    //   - `tax` — tax withheld at source. A taxed bounty pays out net, with the
    //     corp's cut in this field rather than in a journal row of its own, so
    //     without it a null-sec ratter's biggest tax line is invisible.
    //   - the two party ids — a donation between two tracked characters is ISK
    //     moved between the user's own wallets, not income or spending, and
    //     the counterparty id is the only thing that tells the two apart.
    // Rows written before this migration keep the defaults until the next sync
    // re-reads them (the journal reaches ~30 days back, and the upsert now
    // backfills on conflict).
    version: 30,
    name: 'character_wallet_journal_parties',
    sql: `
      ALTER TABLE character_wallet_journal ADD COLUMN tax REAL NOT NULL DEFAULT 0;
      ALTER TABLE character_wallet_journal ADD COLUMN first_party_id INTEGER;
      ALTER TABLE character_wallet_journal ADD COLUMN second_party_id INTEGER;
    `,
  },
  {
    // The map, as a graph: which systems a stargate joins, and where each
    // system sits. Together they answer "which of my characters is nearest to
    // this system" in the two units EVE measures distance in — gate jumps for
    // the character who has to fly there, light years for the capital that
    // would jump to the cyno once it arrives.
    //
    // The position columns are nullable rather than zero-defaulted: a profile
    // whose map was imported before this migration has no coordinates at all,
    // and NULL says that, where (0,0,0) would read as a system near the centre
    // of New Eden. `sde_system_jumps` is likewise simply empty until the next
    // import — `getSdeStatus().hasJumpData` is what tells the UI to ask for one.
    version: 31,
    name: 'sde_system_jumps',
    sql: `
      ALTER TABLE sde_systems ADD COLUMN pos_x REAL;
      ALTER TABLE sde_systems ADD COLUMN pos_y REAL;
      ALTER TABLE sde_systems ADD COLUMN pos_z REAL;

      CREATE TABLE sde_system_jumps (
        from_system_id INTEGER NOT NULL,
        to_system_id   INTEGER NOT NULL,
        PRIMARY KEY (from_system_id, to_system_id)
      );
    `,
  },
];

export const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]!.version;

/** Thrown when the profile was written by a build newer than this one. */
export class SchemaVersionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SchemaVersionError';
  }
}

/**
 * Why a database can be too new to open, in words a user can act on — or null
 * when this build understands it.
 *
 * Migrations only move forward, so a profile whose highest applied version
 * exceeds ours was written by a later build: it may hold tables we've never
 * heard of and columns that have since moved. Nothing in `runMigrations` would
 * complain — `pending` simply comes back empty — and the failure would instead
 * surface as a stray SQL error at whatever query first touched a changed table,
 * far from the cause. Refuse at open time instead.
 */
export function schemaDowngradeMessage(dbVersion: number, appVersion: number): string | null {
  if (dbVersion <= appVersion) return null;
  return (
    `This profile's database is at schema v${dbVersion}, but this build of MCO ` +
    `understands only up to v${appVersion}.\n\n` +
    `It was last opened by a newer version of MCO. Re-install that version, or move ` +
    `mco.sqlite out of the data folder to start from a fresh profile.`
  );
}

/** Highest migration recorded against this database; 0 for an empty profile. */
export function appliedSchemaVersion(db: Database): number {
  const row = db
    .prepare('SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations')
    .get() as { v: number };
  return row.v;
}

export function runMigrations(db: Database): void {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime(\'now\')))');

  const current = appliedSchemaVersion(db);

  const tooNew = schemaDowngradeMessage(current, LATEST_SCHEMA_VERSION);
  if (tooNew !== null) throw new SchemaVersionError(tooNew);

  const pending = MIGRATIONS.filter((m) => m.version > current).sort(
    (a, b) => a.version - b.version,
  );

  for (const migration of pending) {
    const apply = db.transaction(() => {
      db.exec(migration.sql);
      db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(migration.version);
    });
    apply();
  }
}
