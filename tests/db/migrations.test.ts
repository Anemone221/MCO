import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { closeDb, getDb } from '@main/db';
import { DB_FILE_NAME, backupsDir } from '@main/db/backupFiles';
import {
  LATEST_SCHEMA_VERSION,
  MIGRATIONS,
  SchemaVersionError,
  appliedSchemaVersion,
  runMigrations,
} from '@main/db/migrations';
import { useFreshProfile } from './support/profile';

/** Apply the first `count` migrations by hand, the way an older build would have. */
function migrateTo(db: Database.Database, count: number): void {
  db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))",
  );
  for (const migration of MIGRATIONS.slice(0, count)) {
    db.exec(migration.sql);
    db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(migration.version);
  }
}

describe('migrations', () => {
  const profile = useFreshProfile();

  it('are numbered 1..N with no gaps or repeats', () => {
    expect(MIGRATIONS.map((m) => m.version)).toEqual(MIGRATIONS.map((_, index) => index + 1));
  });

  it('all apply to an empty database', () => {
    const db = getDb();
    expect(appliedSchemaVersion(db)).toBe(LATEST_SCHEMA_VERSION);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
    // A schema that applies can still be internally inconsistent.
    expect(db.pragma('foreign_key_check')).toEqual([]);
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
  });

  it('are a no-op on a database that is already current', () => {
    getDb();
    closeDb();
    const db = getDb();
    const applied = db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get() as {
      n: number;
    };
    expect(applied.n).toBe(MIGRATIONS.length);
  });

  it('reach the same schema from every earlier version as from scratch', () => {
    const schemaOf = (db: Database.Database): unknown[] =>
      db
        .prepare(
          "SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name",
        )
        .all();

    const fresh = new Database(':memory:');
    runMigrations(fresh);
    const expected = schemaOf(fresh);
    fresh.close();

    // Every stopping point an installed build could be sitting at.
    for (let count = 1; count < MIGRATIONS.length; count += 1) {
      const db = new Database(':memory:');
      migrateTo(db, count);
      runMigrations(db);
      expect(schemaOf(db), `upgrading from v${count}`).toEqual(expected);
      db.close();
    }
  });

  it('keep existing rows when a database is upgraded', () => {
    // v1 is the oldest shape a profile can have; a character stored then must
    // still be there, readable through today's columns, after every migration.
    const db = new Database(':memory:');
    migrateTo(db, 1);
    db.prepare("INSERT INTO characters (id, name) VALUES (90000001, 'Old Timer')").run();
    runMigrations(db);
    expect(db.prepare('SELECT name FROM characters WHERE id = 90000001').get()).toEqual({
      name: 'Old Timer',
    });
    db.close();
  });

  it('snapshot the profile before upgrading it, but not when creating it', () => {
    const dir = profile();

    getDb();
    closeDb();
    expect(existsSync(backupsDir(dir))).toBe(false);

    // Wind the profile back one version, as if the previous build had left it.
    const old = new Database(join(dir, DB_FILE_NAME));
    old.prepare('DELETE FROM schema_migrations WHERE version = ?').run(LATEST_SCHEMA_VERSION);
    old.close();

    // The last migration is replayed onto tables that already exist; whether
    // that succeeds is not the point here — the snapshot must come first.
    try {
      getDb();
    } catch {
      // expected for a migration that is not re-runnable
    }

    const backups = readdirSync(backupsDir(dir));
    expect(backups).toHaveLength(1);
    expect(backups[0]).toMatch(new RegExp(`^mco-pre-v${LATEST_SCHEMA_VERSION - 1}-`));

    const snapshot = new Database(join(backupsDir(dir), backups[0]!), { readonly: true });
    expect(appliedSchemaVersion(snapshot)).toBe(LATEST_SCHEMA_VERSION - 1);
    snapshot.close();
  });

  it('refuse a database written by a newer build', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(LATEST_SCHEMA_VERSION + 1);
    expect(() => runMigrations(db)).toThrow(SchemaVersionError);
    db.close();
  });
});
