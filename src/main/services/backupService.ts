import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import Database from 'better-sqlite3';
import type { BackupInfo } from '@shared/types';
import { closeDb, dbDir, getDb } from '../db';
import {
  AUTO_BACKUPS_KEPT,
  autoBackupName,
  backupsDir,
  isAutoBackupDue,
  listBackupFiles,
  pruneBackups,
  resolveBackupPath,
  scheduleRestore,
} from '../db/backupFiles';
import { LATEST_SCHEMA_VERSION, appliedSchemaVersion } from '../db/migrations';
import { UserFacingError } from '../errors';
import { flushLogFile } from '../log';

/**
 * MCO's own backups: a weekly snapshot, and restoring from any snapshot it
 * holds. The pre-migration snapshot is taken in `db/index.ts`, where the
 * migration runs; the file rules both share live in `db/backupFiles.ts`.
 */

/** Backups belong to the database in use — the dev copy keeps its own under `dev/`. */
const userDataDir = (): string => dbDir();

/** The snapshots in the profile's `backups` folder, newest first. */
export function listBackups(): BackupInfo[] {
  return listBackupFiles(userDataDir());
}

let autoBackupInFlight = false;

/**
 * Take the weekly snapshot if the newest one is a week old (or there is none),
 * then drop the oldest beyond {@link AUTO_BACKUPS_KEPT}. Called from every
 * scheduler sweep, so a tray session that runs for a month still gets its four.
 *
 * Uses better-sqlite3's online backup, which copies in steps between other
 * work — the app keeps answering while it runs. Never throws: a failed backup
 * is a line in the log and another attempt on the next sweep.
 */
export async function runAutoBackupIfDue(now = Date.now()): Promise<void> {
  if (autoBackupInFlight) return;
  autoBackupInFlight = true;
  try {
    if (!isAutoBackupDue(listBackups(), now)) return;
    const dir = backupsDir(userDataDir());
    mkdirSync(dir, { recursive: true });
    const target = join(dir, autoBackupName(new Date(now)));
    await getDb().backup(target);
    console.log(`[backup] weekly snapshot saved to ${target}`);
    pruneBackups(userDataDir(), 'auto', AUTO_BACKUPS_KEPT);
  } catch (err) {
    console.error('[backup] the weekly snapshot failed:', err);
  } finally {
    autoBackupInFlight = false;
  }
}

/**
 * Check that a snapshot is a database this build can open. Done before the
 * restart rather than after it: a restore that only fails once MCO is already
 * closing leaves the user looking at an error dialog instead of the Settings
 * page they asked from.
 */
function assertRestorable(path: string): void {
  let version: number;
  try {
    const snapshot = new Database(path, { readonly: true, fileMustExist: true });
    try {
      version = appliedSchemaVersion(snapshot);
    } finally {
      snapshot.close();
    }
  } catch {
    throw new UserFacingError('That backup could not be read as an MCO database.');
  }
  if (version > LATEST_SCHEMA_VERSION) {
    throw new UserFacingError(
      `That backup was made by a newer MCO (schema v${version}; this build understands up to v${LATEST_SCHEMA_VERSION}).`,
    );
  }
}

/**
 * Restore one of MCO's snapshots: record the request and restart. The swap
 * itself happens on the way back up, before the database is opened (see
 * `applyPendingRestore`), and keeps the replaced database as
 * `mco-before-restore.sqlite`.
 *
 * `stopBackgroundWork` is the scheduler's stop, passed in rather than imported:
 * the scheduler already imports this module for the weekly snapshot.
 */
export function restoreBackup(fileName: string, stopBackgroundWork: () => void): void {
  const path = resolveBackupPath(userDataDir(), fileName);
  if (path === null) throw new UserFacingError('That backup is no longer in the backups folder.');
  assertRestorable(path);

  scheduleRestore(userDataDir(), fileName);
  console.log(`[backup] restoring ${fileName}; restarting`);

  // Closed by hand because `app.exit` skips the normal quit path: this
  // checkpoints the WAL, so the copy kept as "before restore" is complete.
  stopBackgroundWork();
  closeDb();
  flushLogFile();
  app.relaunch();
  app.exit(0);
}
