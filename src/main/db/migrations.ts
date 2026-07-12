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
