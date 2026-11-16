import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { app, dialog } from 'electron';
import Database from 'better-sqlite3';
import {
  DB_FILE_NAME,
  PRE_MIGRATION_BACKUPS_KEPT,
  applyPendingRestore,
  backupsDir,
  preMigrationBackupName,
  pruneBackups,
} from './backupFiles';
import {
  type DbMode,
  copyProdToDev,
  dbDir as dbDirFor,
  parseDbMode,
} from './dbMode';
import { adoptProdTokens } from './devTokens';
import { runMigrations } from './migrations';

let db: Database.Database | null = null;
/** The prod database, held open during a dev launch for token write-through. */
let prodMirror: Database.Database | null = null;

/** Which database this launch works on (`--db=dev|prod`; prod when absent). */
export function dbMode(): DbMode {
  return parseDbMode(process.argv).mode;
}

/**
 * The folder holding this launch's database, its backups and its restore
 * marker: the profile folder itself for prod, `dev/` inside it for dev.
 * Everything else in the profile (logs, the SDE download) is shared.
 */
export function dbDir(): string {
  return dbDirFor(app.getPath('userData'), dbMode());
}

export function dbFilePath(): string {
  return join(dbDir(), DB_FILE_NAME);
}

/** Thrown by `getDb()` when the user declines a migration of the prod database. */
export class MigrationDeclinedError extends Error {
  constructor() {
    super('The production database was left unmigrated.');
    this.name = 'MigrationDeclinedError';
  }
}

/**
 * Ask before a build run from source migrates the prod database.
 *
 * Migrations only move forward, and a build refuses a database newer than it
 * understands — so once this build has migrated prod, the installed release
 * (and any older checkout) can no longer open it. That is routine for an
 * installed update and a trap for a development build, which may carry a
 * migration that is still being written. An installed build never asks: its
 * migrations arrive through the updater and have to run on an unattended
 * tray launch.
 */
function confirmProdMigration(from: number, to: number): void {
  const choice = dialog.showMessageBoxSync({
    type: 'warning',
    title: 'Migrate the production database?',
    message: `This build will migrate your production database from schema v${from} to v${to}.`,
    detail:
      'This cannot be stepped back: builds that only understand the older schema, ' +
      'including the installed MCO until it is updated, will refuse to open the database ' +
      'afterwards. A backup is saved to the backups folder first; restoring it is the only ' +
      'way back.\n\nTo try this migration on a copy first, quit and launch with --db=dev --copy-prod.',
    buttons: ['Quit without migrating', 'Migrate production'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  });
  if (choice !== 1) throw new MigrationDeclinedError();
}

/** `--db=dev --copy-prod`: start this launch from a fresh copy of prod. */
function replaceDevWithProd(userDataDir: string): void {
  console.log(
    copyProdToDev(userDataDir)
      ? '[db] dev database: replaced with a fresh copy of the production database'
      : '[db] dev database: --copy-prod found no production database to copy; left as it was',
  );
}

/**
 * The prod database during a dev launch, or null on a prod launch (or when
 * there is no prod database). Only for writing a refreshed token through — see
 * `devTokens.ts`. Opened on first use and closed with the dev database.
 */
export function getProdMirrorDb(): Database.Database | null {
  if (prodMirror) return prodMirror;
  if (dbMode() !== 'dev') return null;
  const prodFile = join(app.getPath('userData'), DB_FILE_NAME);
  if (!existsSync(prodFile)) return null;
  prodMirror = new Database(prodFile, { fileMustExist: true });
  return prodMirror;
}

/**
 * Swap in a backup the user asked to restore before quitting (Settings →
 * Backup). Runs before the database is opened, which is the only moment the
 * file can be replaced without racing a sync.
 *
 * A failed restore is reported and MCO carries on with the database it has:
 * the alternative — refusing to start — would turn a bad backup file into a
 * profile that cannot be opened at all.
 */
function restoreIfPending(userDataDir: string): void {
  try {
    const restored = applyPendingRestore(userDataDir);
    if (restored !== null) console.log(`[db] restored the database from backup ${restored}`);
  } catch (err) {
    console.error('[db] the pending restore failed; keeping the current database:', err);
    dialog.showErrorBox(
      'Restore failed',
      `MCO could not restore the backup, so your current data is unchanged.\n\n${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

/**
 * Snapshot the profile before an update's migrations change it.
 *
 * Migrations arrive through the auto-updater and run unattended on the next
 * start, against data that cannot be fetched again (banked wallet and mining
 * history, the whole organization model). A snapshot taken first turns a faulty
 * migration into a restore.
 *
 * `VACUUM INTO` rather than better-sqlite3's `backup()`: that API is async and
 * this has to finish before the first migration runs. It writes a consistent,
 * self-contained copy and is safe under WAL.
 *
 * Best-effort. A snapshot that cannot be written (a full disk, most likely) is
 * logged and the migration goes ahead — each one is transactional, and holding
 * the app shut over a missing safety copy would be the worse outcome.
 */
function snapshotBeforeMigrating(
  database: Database.Database,
  userDataDir: string,
  from: number,
  to: number,
): void {
  const dir = backupsDir(userDataDir);
  const target = join(dir, preMigrationBackupName(from, new Date()));
  try {
    mkdirSync(dir, { recursive: true });
    rmSync(target, { force: true }); // VACUUM INTO refuses an existing file
    database.prepare('VACUUM INTO ?').run(target);
    console.log(`[db] schema v${from} → v${to}: saved a pre-migration backup to ${target}`);
    pruneBackups(userDataDir, 'pre-migration', PRE_MIGRATION_BACKUPS_KEPT);
  } catch (err) {
    console.error(`[db] could not save a backup before migrating v${from} → v${to}:`, err);
  }
}

export function getDb(): Database.Database {
  if (db) return db;

  const userDataDir = app.getPath('userData');
  const { mode, copyProd } = parseDbMode(process.argv);
  // Before anything is opened: this replaces the dev database file.
  if (copyProd) replaceDevWithProd(userDataDir);

  const dir = dbDirFor(userDataDir, mode);
  mkdirSync(dir, { recursive: true });
  restoreIfPending(dir);

  const opened = new Database(join(dir, DB_FILE_NAME));
  try {
    opened.pragma('journal_mode = WAL');
    opened.pragma('foreign_keys = ON');
    opened.pragma('synchronous = NORMAL');
    runMigrations(opened, {
      beforeMigrate: (from, to) => {
        if (mode === 'prod' && !app.isPackaged) confirmProdMigration(from, to);
        snapshotBeforeMigrating(opened, dir, from, to);
      },
    });
    if (mode === 'dev' && !copyProd) {
      // A dev database copied from prod on an earlier launch holds prod's
      // logins, and prod may have refreshed them since; a consumed refresh
      // token must never be presented to SSO. (A blank one has none to take.)
      try {
        const prod = getProdMirrorDb();
        if (prod) {
          const adopted = adoptProdTokens(opened, prod);
          if (adopted > 0) {
            console.log(`[db] dev database: took ${adopted} stored login(s) from production`);
          }
        }
      } catch (err) {
        // Not worth refusing to start over: the cost is dev characters that may
        // read "login expired" until the next --copy-prod.
        console.error('[db] dev database: could not take stored logins from production:', err);
      }
    }
  } catch (err) {
    // A database that failed to open must not stay open: the handle would keep
    // the file locked, and the user's way out of a failed migration is to
    // replace that file with a backup.
    opened.close();
    closeProdMirror();
    throw err;
  }
  db = opened;
  return db;
}

function closeProdMirror(): void {
  if (prodMirror) {
    prodMirror.close();
    prodMirror = null;
  }
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
  closeProdMirror();
}
