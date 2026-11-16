import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, join } from 'node:path';
import type { BackupInfo } from '@shared/types';

/**
 * The files behind MCO's own backups: where they live, what they are called,
 * which ones to keep, and the restore hand-over.
 *
 * Everything here is plain file work with no Electron or SQLite dependency, so
 * the retention and restore rules are unit-tested against a temp directory.
 * Taking a snapshot — which needs the open database — is `db/index.ts` (before
 * a migration) and `services/backupService.ts` (weekly).
 */

export const DB_FILE_NAME = 'mco.sqlite';
const BACKUPS_DIR_NAME = 'backups';
const RESTORE_MARKER_NAME = 'restore-pending.json';
/** The database a restore replaced. One file, overwritten by the next restore. */
export const BEFORE_RESTORE_FILE_NAME = 'mco-before-restore.sqlite';

/** Weekly snapshots kept; the oldest goes when a sixth is taken. */
export const AUTO_BACKUPS_KEPT = 5;
/** Pre-migration snapshots kept — the last few updates' worth. */
export const PRE_MIGRATION_BACKUPS_KEPT = 3;
export const AUTO_BACKUP_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

const AUTO_NAME = /^mco-auto-\d{8}-\d{6}\.sqlite$/;
const PRE_MIGRATION_NAME = /^mco-pre-v\d+-\d{8}-\d{6}\.sqlite$/;

export function backupsDir(userDataDir: string): string {
  return join(userDataDir, BACKUPS_DIR_NAME);
}

/** Timestamp for a backup filename, e.g. 20260716-143207 (local time). */
function fileStamp(now: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  );
}

export function autoBackupName(now: Date): string {
  return `mco-auto-${fileStamp(now)}.sqlite`;
}

/** `schemaVersion` is the version the snapshot is *at* — the one being migrated away from. */
export function preMigrationBackupName(schemaVersion: number, now: Date): string {
  return `mco-pre-v${schemaVersion}-${fileStamp(now)}.sqlite`;
}

/** Which kind of backup a file name is, or null for a file MCO did not put there. */
export function backupKind(fileName: string): BackupInfo['kind'] | null {
  if (AUTO_NAME.test(fileName)) return 'auto';
  if (PRE_MIGRATION_NAME.test(fileName)) return 'pre-migration';
  if (fileName === BEFORE_RESTORE_FILE_NAME) return 'before-restore';
  return null;
}

/** MCO's backups in `userDataDir`, newest first. Files it does not recognise are ignored. */
export function listBackupFiles(userDataDir: string): BackupInfo[] {
  const dir = backupsDir(userDataDir);
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return []; // no backup has been taken yet
  }

  const backups: BackupInfo[] = [];
  for (const fileName of names) {
    const kind = backupKind(fileName);
    if (kind === null) continue;
    try {
      const stat = statSync(join(dir, fileName));
      if (!stat.isFile()) continue;
      backups.push({
        fileName,
        kind,
        createdAt: stat.mtime.toISOString(),
        sizeBytes: stat.size,
      });
    } catch {
      // vanished between the listing and the stat; nothing to report
    }
  }
  return backups.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** True when no weekly snapshot exists yet, or the newest one is a week old. */
export function isAutoBackupDue(backups: BackupInfo[], now: number): boolean {
  const newest = backups.find((b) => b.kind === 'auto');
  if (!newest) return true;
  return now - new Date(newest.createdAt).getTime() >= AUTO_BACKUP_INTERVAL_MS;
}

/** Delete all but the newest `keep` backups of one kind. Returns the names removed. */
export function pruneBackups(userDataDir: string, kind: BackupInfo['kind'], keep: number): string[] {
  const surplus = listBackupFiles(userDataDir)
    .filter((b) => b.kind === kind)
    .slice(keep);
  const removed: string[] = [];
  for (const backup of surplus) {
    try {
      rmSync(join(backupsDir(userDataDir), backup.fileName), { force: true });
      removed.push(backup.fileName);
    } catch {
      // still open elsewhere (a virus scanner, a sync client); the next prune gets it
    }
  }
  return removed;
}

/**
 * Full path of a backup the user asked to restore, or null when `fileName` is
 * not one of MCO's backups. The name crosses from the renderer, so it is
 * matched against the known patterns rather than joined onto the folder as
 * given — `basename` plus the pattern is what keeps it inside `backups/`.
 */
export function resolveBackupPath(userDataDir: string, fileName: string): string | null {
  if (basename(fileName) !== fileName || backupKind(fileName) === null) return null;
  const path = join(backupsDir(userDataDir), fileName);
  return existsSync(path) ? path : null;
}

/**
 * Record that `fileName` should replace the database on the next start.
 *
 * A restore is not done in place: the running app has the database open, a
 * sweep may be mid-write, and `getDb()` reopens lazily, so swapping the file
 * under it would race all three. The swap is instead left for
 * {@link applyPendingRestore}, which runs at startup before anything opens it.
 */
export function scheduleRestore(userDataDir: string, fileName: string): void {
  writeFileSync(join(userDataDir, RESTORE_MARKER_NAME), JSON.stringify({ fileName }), 'utf8');
}

/**
 * Carry out a restore scheduled by {@link scheduleRestore}. Returns the name of
 * the backup now in place, or null when none was pending. Must run before the
 * database is opened.
 *
 * The database being replaced is kept as `mco-before-restore.sqlite`, so
 * restoring the wrong snapshot is itself undoable. The marker is removed
 * before anything else is touched: a restore that fails must fail once, not on
 * every start from then on.
 */
export function applyPendingRestore(userDataDir: string): string | null {
  const marker = join(userDataDir, RESTORE_MARKER_NAME);
  if (!existsSync(marker)) return null;

  let fileName: unknown;
  try {
    fileName = (JSON.parse(readFileSync(marker, 'utf8')) as { fileName?: unknown }).fileName;
  } finally {
    rmSync(marker, { force: true });
  }
  if (typeof fileName !== 'string') throw new Error('The pending restore names no backup.');

  const source = resolveBackupPath(userDataDir, fileName);
  if (source === null) throw new Error(`The backup "${fileName}" is no longer in the backups folder.`);

  const live = join(userDataDir, DB_FILE_NAME);
  // Copied to a sibling first and renamed into place, so a copy that dies
  // halfway (disk full) leaves the current database untouched.
  const staged = `${live}.restoring`;
  copyFileSync(source, staged);

  // After staging, so restoring `mco-before-restore.sqlite` itself still works:
  // its contents are already copied out by the time it is overwritten here.
  if (existsSync(live)) {
    mkdirSync(backupsDir(userDataDir), { recursive: true });
    copyFileSync(live, join(backupsDir(userDataDir), BEFORE_RESTORE_FILE_NAME));
  }
  // The WAL and shared-memory files belong to the database being replaced.
  // Left behind, SQLite would replay the old database's pages into the new one.
  rmSync(`${live}-wal`, { force: true });
  rmSync(`${live}-shm`, { force: true });
  renameSync(staged, live);
  return fileName;
}
