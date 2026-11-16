import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DB_FILE_NAME } from './backupFiles';

/**
 * Which database a launch works on: the real profile (`prod`) or a scratch
 * one (`dev`), chosen with `--db=dev` / `--db=prod` on the command line.
 *
 * The dev database lives in `<userData>/dev/`, inside the same profile folder
 * on purpose: the single-instance lock is per profile folder, so a dev launch
 * and a prod launch can never run at once, and `safeStorage` uses one key for
 * both, so the copied refresh tokens still decrypt.
 *
 * The dev database starts blank and keeps whatever dev launches put in it.
 * `--db=dev --copy-prod` replaces it with a straight copy of the prod database
 * for that launch onwards — the way to try a build's migrations on real data
 * without touching prod. A launch with no `--db` (the installed app) is prod.
 *
 * Plain argv and file work, no Electron or SQLite, so it is unit-tested
 * against a temp directory. The SQL half — keeping refresh tokens in step
 * between the two databases — is `devTokens.ts`.
 */
export type DbMode = 'prod' | 'dev';

export interface DbModeChoice {
  mode: DbMode;
  /** `--copy-prod`: replace the dev database with a copy of prod before opening it. */
  copyProd: boolean;
}

const DB_SWITCH = '--db';
const COPY_PROD_SWITCH = '--copy-prod';
const DEV_DIR_NAME = 'dev';

/**
 * Read `--db=dev|prod` and `--copy-prod` from a launch's arguments; prod when
 * `--db` is absent.
 *
 * An unrecognised value throws rather than falling back: the fallback would be
 * prod, and a typo in `--db=dev` must not quietly open the real database. For
 * the same reason `--copy-prod` without `--db=dev` is an error, not a no-op.
 */
export function parseDbMode(argv: readonly string[]): DbModeChoice {
  const copyProd = argv.includes(COPY_PROD_SWITCH);
  const arg = argv.find((a) => a === DB_SWITCH || a.startsWith(`${DB_SWITCH}=`));

  let mode: DbMode = 'prod';
  if (arg !== undefined) {
    const value = arg.slice(DB_SWITCH.length + 1);
    if (value !== 'dev' && value !== 'prod') {
      throw new Error(`Unrecognised database "${arg}". Use --db=dev or --db=prod.`);
    }
    mode = value;
  }
  if (copyProd && mode !== 'dev') {
    throw new Error(
      `${COPY_PROD_SWITCH} only applies to the dev database. Use --db=dev ${COPY_PROD_SWITCH}.`,
    );
  }
  return { mode, copyProd };
}

/** The folder holding a mode's database, its backups and its restore marker. */
export function dbDir(userDataDir: string, mode: DbMode): string {
  return mode === 'dev' ? join(userDataDir, DEV_DIR_NAME) : userDataDir;
}

/**
 * Replace the dev database with a straight copy of prod (`--copy-prod`).
 * Returns false, leaving dev as it was, when there is no prod database yet.
 *
 * Must run before either database is opened. It is a file copy, so it relies
 * on nothing having prod open — which the single-instance lock guarantees. The
 * write-ahead log is copied with the main file: after an unclean exit it holds
 * committed pages the main file does not.
 */
export function copyProdToDev(userDataDir: string): boolean {
  const prodFile = join(userDataDir, DB_FILE_NAME);
  const devDir = dbDir(userDataDir, 'dev');
  const devFile = join(devDir, DB_FILE_NAME);

  if (!existsSync(prodFile)) return false;

  mkdirSync(devDir, { recursive: true });
  // Staged and renamed into place, so a copy that dies halfway (disk full)
  // never leaves a truncated file under the live name.
  const staged = `${devFile}.copying`;
  copyFileSync(prodFile, staged);

  // The old dev database's log must not be replayed into the new copy.
  rmSync(`${devFile}-wal`, { force: true });
  rmSync(`${devFile}-shm`, { force: true });
  if (existsSync(`${prodFile}-wal`)) copyFileSync(`${prodFile}-wal`, `${devFile}-wal`);
  renameSync(staged, devFile);
  return true;
}
