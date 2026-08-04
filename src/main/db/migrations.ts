import type { Database } from 'better-sqlite3';

interface Migration {
  version: number;
  name: string;
  sql: string;
}

const MIGRATIONS: Migration[] = [
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
];

export function runMigrations(db: Database): void {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime(\'now\')))');

  const appliedRow = db
    .prepare('SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations')
    .get() as { v: number };
  const current = appliedRow.v;

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

export const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]!.version;
