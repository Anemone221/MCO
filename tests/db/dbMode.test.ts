import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { MigrationDeclinedError, closeDb, dbDir, dbFilePath, getDb } from '@main/db';
import { DB_FILE_NAME, backupsDir } from '@main/db/backupFiles';
import { LATEST_SCHEMA_VERSION, appliedSchemaVersion } from '@main/db/migrations';
import { getToken, saveToken } from '@main/db/repositories/tokens';
import { setMessageBoxChoice } from './support/electron';
import { useFreshProfile } from './support/profile';

const ALICE = 90000001;
const BOB = 90000002;

const DB_SWITCHES = /^--(db|copy-prod)\b/;

function clearDbSwitches(): void {
  process.argv = process.argv.filter((arg) => !DB_SWITCHES.test(arg));
}

/** Relaunch with the given switches, the way a new process started with them would. */
function launch(...switches: string[]): Database.Database {
  closeDb();
  clearDbSwitches();
  process.argv.push(...switches);
  return getDb();
}

const launchDev = (): Database.Database => launch('--db=dev');
const launchDevCopy = (): Database.Database => launch('--db=dev', '--copy-prod');
const launchProd = (): Database.Database => launch('--db=prod');
/** No `--db` at all: what the installed app does. */
const launchInstalled = (): Database.Database => launch();

function addCharacter(db: Database.Database, id: number, refreshToken: string): void {
  db.prepare('INSERT INTO characters (id, name) VALUES (?, ?)').run(id, `Character ${id}`);
  db.prepare(
    "INSERT INTO tokens (character_id, refresh_token_encrypted, scopes) VALUES (?, ?, 'a b')",
  ).run(id, Buffer.from(refreshToken));
}

const characterNames = (db: Database.Database): string[] =>
  (db.prepare('SELECT name FROM characters ORDER BY id').all() as Array<{ name: string }>).map(
    (row) => row.name,
  );

const storedToken = (id: number): string | undefined =>
  getToken(id)?.refreshTokenEncrypted.toString();

/** Read a token straight from the prod file, whatever database is in use. */
function prodToken(profileDir: string, id: number): string | undefined {
  const prod = new Database(join(profileDir, DB_FILE_NAME), { readonly: true });
  try {
    const row = prod
      .prepare('SELECT refresh_token_encrypted AS t FROM tokens WHERE character_id = ?')
      .get(id) as { t: Buffer } | undefined;
    return row?.t.toString();
  } finally {
    prod.close();
  }
}

/** Wind a closed database back one schema version, as an older build would have left it. */
function rewindOneVersion(file: string): void {
  const db = new Database(file);
  db.prepare('DELETE FROM schema_migrations WHERE version = ?').run(LATEST_SCHEMA_VERSION);
  db.close();
}

describe('dev and prod databases', () => {
  const profile = useFreshProfile();

  afterEach(() => {
    clearDbSwitches();
    setMessageBoxChoice(1);
  });

  it('opens the profile database when no --db is given', () => {
    launchInstalled();
    expect(dbDir()).toBe(profile());
    expect(dbFilePath()).toBe(join(profile(), DB_FILE_NAME));
  });

  it('starts dev blank, in its own folder, and leaves prod alone', () => {
    addCharacter(launchProd(), ALICE, 'alice-1');

    const dev = launchDev();
    expect(dbFilePath()).toBe(join(profile(), 'dev', DB_FILE_NAME));
    expect(appliedSchemaVersion(dev)).toBe(LATEST_SCHEMA_VERSION);
    expect(characterNames(dev)).toEqual([]);

    addCharacter(dev, BOB, 'bob-dev-only');
    expect(characterNames(launchInstalled())).toEqual([`Character ${ALICE}`]);
  });

  it('keeps what dev launches put in the dev database', () => {
    addCharacter(launchDev(), BOB, 'bob-dev-only');
    launchProd();
    launchInstalled();
    expect(characterNames(launchDev())).toEqual([`Character ${BOB}`]);
  });

  it('replaces dev with a copy of prod on --copy-prod, and only then', () => {
    addCharacter(launchProd(), ALICE, 'alice-1');
    addCharacter(launchDev(), BOB, 'bob-dev-only');

    const copy = launchDevCopy();
    expect(characterNames(copy)).toEqual([`Character ${ALICE}`]);
    expect(storedToken(ALICE)).toBe('alice-1');

    // The copy is now the dev database: changes to it survive later dev launches.
    copy.prepare("UPDATE characters SET name = 'Renamed in dev' WHERE id = ?").run(ALICE);
    expect(characterNames(launchDev())).toEqual(['Renamed in dev']);
    expect(characterNames(launchInstalled())).toEqual([`Character ${ALICE}`]);
  });

  it('writes a login refreshed on dev through to prod', () => {
    addCharacter(launchProd(), ALICE, 'alice-1');

    const dev = launchDevCopy();
    addCharacter(dev, BOB, 'bob-dev-only');
    saveToken({ characterId: ALICE, refreshTokenEncrypted: Buffer.from('alice-2'), scopes: 'a b' });
    saveToken({ characterId: BOB, refreshTokenEncrypted: Buffer.from('bob-2'), scopes: 'a b' });
    expect(storedToken(ALICE)).toBe('alice-2');

    closeDb();
    expect(prodToken(profile(), ALICE)).toBe('alice-2');
    // A character added on dev stays a dev-only character.
    expect(prodToken(profile(), BOB)).toBeUndefined();
  });

  it('takes the logins prod refreshed since the copy, on a later dev launch', () => {
    addCharacter(launchProd(), ALICE, 'alice-1');
    launchDevCopy();

    // The installed app runs and rotates the token; the dev copy's is now dead.
    launchInstalled();
    saveToken({ characterId: ALICE, refreshTokenEncrypted: Buffer.from('alice-2'), scopes: 'a b' });

    launchDev();
    expect(storedToken(ALICE)).toBe('alice-2');
  });

  it('migrates a copied dev database without asking, and keeps its backups apart', () => {
    addCharacter(launchProd(), ALICE, 'alice-1');
    closeDb();
    rewindOneVersion(join(profile(), DB_FILE_NAME));

    setMessageBoxChoice(0); // would decline, if dev were ever asked
    try {
      launchDevCopy();
    } catch (err) {
      // a migration that is not re-runnable; the snapshot comes first
      expect(err).not.toBeInstanceOf(MigrationDeclinedError);
    }
    closeDb();

    expect(readdirSync(backupsDir(join(profile(), 'dev')))).toHaveLength(1);
    expect(existsSync(backupsDir(profile()))).toBe(false);
    // Prod is still at the older schema: the migration ran on the copy only.
    const prod = new Database(join(profile(), DB_FILE_NAME), { readonly: true });
    expect(appliedSchemaVersion(prod)).toBe(LATEST_SCHEMA_VERSION - 1);
    prod.close();
  });

  it('asks before a build run from source migrates prod, and stops on "no"', () => {
    launchInstalled();
    closeDb();
    rewindOneVersion(join(profile(), DB_FILE_NAME));

    setMessageBoxChoice(0);
    expect(() => launchProd()).toThrow(MigrationDeclinedError);
    expect(() => launchInstalled()).toThrow(MigrationDeclinedError);

    // Declined means untouched: no migration, and no snapshot either.
    const untouched = new Database(join(profile(), DB_FILE_NAME), { readonly: true });
    expect(appliedSchemaVersion(untouched)).toBe(LATEST_SCHEMA_VERSION - 1);
    untouched.close();
    expect(existsSync(backupsDir(profile()))).toBe(false);
  });

  it('refuses an unrecognised --db value, and --copy-prod on prod', () => {
    expect(() => launch('--db=production')).toThrow(/--db=dev or --db=prod/);
    expect(() => launch('--copy-prod')).toThrow(/--db=dev --copy-prod/);
  });
});
