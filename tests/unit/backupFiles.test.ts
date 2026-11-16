import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AUTO_BACKUP_INTERVAL_MS,
  BEFORE_RESTORE_FILE_NAME,
  DB_FILE_NAME,
  applyPendingRestore,
  autoBackupName,
  backupKind,
  backupsDir,
  isAutoBackupDue,
  listBackupFiles,
  preMigrationBackupName,
  pruneBackups,
  resolveBackupPath,
  scheduleRestore,
} from '@main/db/backupFiles';

let profile: string;

beforeEach(() => {
  profile = mkdtempSync(join(tmpdir(), 'mco-backup-'));
});

afterEach(() => {
  rmSync(profile, { recursive: true, force: true });
});

/** Put a backup file in the profile, last modified `ageDays` ago. */
function addBackup(fileName: string, content: string, ageDays = 0): void {
  mkdirSync(backupsDir(profile), { recursive: true });
  const path = join(backupsDir(profile), fileName);
  writeFileSync(path, content);
  const when = new Date(Date.now() - ageDays * 24 * 60 * 60 * 1000);
  utimesSync(path, when, when);
}

describe('backup names', () => {
  it('round-trips the names MCO writes back to their kind', () => {
    const now = new Date(2026, 10, 11, 6, 16, 19);

    expect(autoBackupName(now)).toBe('mco-auto-20261111-061619.sqlite');
    expect(preMigrationBackupName(40, now)).toBe('mco-pre-v40-20261111-061619.sqlite');

    expect(backupKind(autoBackupName(now))).toBe('auto');
    expect(backupKind(preMigrationBackupName(40, now))).toBe('pre-migration');
    expect(backupKind(BEFORE_RESTORE_FILE_NAME)).toBe('before-restore');
  });

  it('does not claim files it did not write', () => {
    expect(backupKind('mco.sqlite')).toBeNull();
    expect(backupKind('mco-backup-20261111-0616.sqlite')).toBeNull(); // a manual export
    expect(backupKind('mco-auto-20261111-061619.sqlite.part')).toBeNull();
  });
});

describe('listBackupFiles', () => {
  it('is empty for a profile that has never been backed up', () => {
    expect(listBackupFiles(profile)).toEqual([]);
  });

  it('lists recognised backups newest first and ignores everything else', () => {
    addBackup('mco-auto-20261101-000000.sqlite', 'old', 10);
    addBackup('mco-pre-v39-20261105-000000.sqlite', 'mid', 6);
    addBackup('mco-auto-20261108-000000.sqlite', 'newer', 3);
    addBackup('notes.txt', 'not a backup');

    const backups = listBackupFiles(profile);

    expect(backups.map((b) => b.fileName)).toEqual([
      'mco-auto-20261108-000000.sqlite',
      'mco-pre-v39-20261105-000000.sqlite',
      'mco-auto-20261101-000000.sqlite',
    ]);
    expect(backups[0]).toMatchObject({ kind: 'auto', sizeBytes: 5 });
  });
});

describe('isAutoBackupDue', () => {
  const now = Date.now();

  it('is due when there is no weekly snapshot at all', () => {
    expect(isAutoBackupDue([], now)).toBe(true);
    // A pre-migration snapshot is not a weekly one, however recent.
    addBackup('mco-pre-v39-20261105-000000.sqlite', 'x', 0);
    expect(isAutoBackupDue(listBackupFiles(profile), now)).toBe(true);
  });

  it('is not due while the newest weekly snapshot is under a week old', () => {
    addBackup('mco-auto-20261101-000000.sqlite', 'old', 30);
    addBackup('mco-auto-20261108-000000.sqlite', 'new', 6);

    expect(isAutoBackupDue(listBackupFiles(profile), now)).toBe(false);
  });

  it('is due once the newest weekly snapshot is a week old', () => {
    addBackup('mco-auto-20261101-000000.sqlite', 'old', 8);
    const backups = listBackupFiles(profile);

    expect(isAutoBackupDue(backups, now)).toBe(true);
    expect(
      isAutoBackupDue(backups, new Date(backups[0]!.createdAt).getTime() + AUTO_BACKUP_INTERVAL_MS),
    ).toBe(true);
  });
});

describe('pruneBackups', () => {
  it('keeps the newest of one kind and leaves the other kinds alone', () => {
    addBackup('mco-auto-20261101-000000.sqlite', 'a', 21);
    addBackup('mco-auto-20261108-000000.sqlite', 'b', 14);
    addBackup('mco-auto-20261115-000000.sqlite', 'c', 7);
    addBackup('mco-pre-v39-20261001-000000.sqlite', 'p', 40);

    const removed = pruneBackups(profile, 'auto', 2);

    expect(removed).toEqual(['mco-auto-20261101-000000.sqlite']);
    expect(listBackupFiles(profile).map((b) => b.fileName)).toEqual([
      'mco-auto-20261115-000000.sqlite',
      'mco-auto-20261108-000000.sqlite',
      'mco-pre-v39-20261001-000000.sqlite',
    ]);
  });
});

describe('resolveBackupPath', () => {
  it('finds a backup that exists', () => {
    addBackup('mco-auto-20261108-000000.sqlite', 'x');

    expect(resolveBackupPath(profile, 'mco-auto-20261108-000000.sqlite')).toBe(
      join(backupsDir(profile), 'mco-auto-20261108-000000.sqlite'),
    );
  });

  it('refuses names that could leave the backups folder', () => {
    // The name comes from the renderer; it must never be joined as given.
    writeFileSync(join(profile, DB_FILE_NAME), 'live');

    expect(resolveBackupPath(profile, `../${DB_FILE_NAME}`)).toBeNull();
    expect(resolveBackupPath(profile, '..\\mco.sqlite')).toBeNull();
    expect(resolveBackupPath(profile, join(profile, DB_FILE_NAME))).toBeNull();
  });

  it('refuses a well-formed name with no file behind it', () => {
    expect(resolveBackupPath(profile, 'mco-auto-20261108-000000.sqlite')).toBeNull();
  });
});

describe('applyPendingRestore', () => {
  const live = (): string => join(profile, DB_FILE_NAME);

  it('does nothing when no restore was scheduled', () => {
    writeFileSync(live(), 'live');

    expect(applyPendingRestore(profile)).toBeNull();
    expect(readFileSync(live(), 'utf8')).toBe('live');
  });

  it('swaps the backup in and keeps the replaced database', () => {
    writeFileSync(live(), 'live');
    writeFileSync(`${live()}-wal`, 'stale wal');
    writeFileSync(`${live()}-shm`, 'stale shm');
    addBackup('mco-auto-20261108-000000.sqlite', 'snapshot');
    scheduleRestore(profile, 'mco-auto-20261108-000000.sqlite');

    expect(applyPendingRestore(profile)).toBe('mco-auto-20261108-000000.sqlite');

    expect(readFileSync(live(), 'utf8')).toBe('snapshot');
    expect(readFileSync(join(backupsDir(profile), BEFORE_RESTORE_FILE_NAME), 'utf8')).toBe('live');
    // The old database's WAL would otherwise be replayed into the new one.
    expect(existsSync(`${live()}-wal`)).toBe(false);
    expect(existsSync(`${live()}-shm`)).toBe(false);
    // The backup itself stays, so the same snapshot can be restored again.
    expect(resolveBackupPath(profile, 'mco-auto-20261108-000000.sqlite')).not.toBeNull();
  });

  it('runs once: a second start finds nothing pending', () => {
    writeFileSync(live(), 'live');
    addBackup('mco-auto-20261108-000000.sqlite', 'snapshot');
    scheduleRestore(profile, 'mco-auto-20261108-000000.sqlite');
    applyPendingRestore(profile);

    expect(applyPendingRestore(profile)).toBeNull();
  });

  it('can undo a restore by restoring the "before restore" copy', () => {
    writeFileSync(live(), 'original');
    addBackup('mco-auto-20261108-000000.sqlite', 'snapshot');
    scheduleRestore(profile, 'mco-auto-20261108-000000.sqlite');
    applyPendingRestore(profile);

    scheduleRestore(profile, BEFORE_RESTORE_FILE_NAME);
    applyPendingRestore(profile);

    expect(readFileSync(live(), 'utf8')).toBe('original');
    // And the snapshot it replaced is now the one set aside.
    expect(readFileSync(join(backupsDir(profile), BEFORE_RESTORE_FILE_NAME), 'utf8')).toBe(
      'snapshot',
    );
  });

  it('leaves the database alone, and does not retry, when the backup is gone', () => {
    writeFileSync(live(), 'live');
    scheduleRestore(profile, 'mco-auto-20261108-000000.sqlite');

    expect(() => applyPendingRestore(profile)).toThrow(/no longer in the backups folder/);

    expect(readFileSync(live(), 'utf8')).toBe('live');
    // A failed restore must fail once, not on every start from then on.
    expect(applyPendingRestore(profile)).toBeNull();
  });

  it('refuses a marker that names a file outside the backups folder', () => {
    writeFileSync(live(), 'live');
    writeFileSync(join(profile, 'restore-pending.json'), JSON.stringify({ fileName: '../x.sqlite' }));

    expect(() => applyPendingRestore(profile)).toThrow();
    expect(readFileSync(live(), 'utf8')).toBe('live');
  });
});
