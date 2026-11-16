import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DB_FILE_NAME } from '@main/db/backupFiles';
import { copyProdToDev, dbDir, parseDbMode } from '@main/db/dbMode';

describe('parseDbMode', () => {
  it('defaults to prod', () => {
    expect(parseDbMode(['MCO.exe'])).toEqual({ mode: 'prod', copyProd: false });
    expect(parseDbMode(['MCO.exe', '--background'])).toEqual({ mode: 'prod', copyProd: false });
  });

  it('reads --db=dev and --db=prod among other switches', () => {
    expect(parseDbMode(['electron', '.', '--db=dev'])).toEqual({ mode: 'dev', copyProd: false });
    expect(parseDbMode(['electron', '.', '--no-sandbox', '--db=prod'])).toEqual({
      mode: 'prod',
      copyProd: false,
    });
  });

  it('reads --copy-prod alongside --db=dev, in either order', () => {
    expect(parseDbMode(['electron', '.', '--db=dev', '--copy-prod'])).toEqual({
      mode: 'dev',
      copyProd: true,
    });
    expect(parseDbMode(['electron', '.', '--background', '--copy-prod', '--db=dev'])).toEqual({
      mode: 'dev',
      copyProd: true,
    });
  });

  it('refuses --copy-prod on the prod database', () => {
    expect(() => parseDbMode(['MCO.exe', '--copy-prod'])).toThrow(/--db=dev --copy-prod/);
    expect(() => parseDbMode(['MCO.exe', '--db=prod', '--copy-prod'])).toThrow();
  });

  it('refuses a value it does not know instead of falling back to prod', () => {
    expect(() => parseDbMode(['MCO.exe', '--db=dve'])).toThrow(/--db=dev or --db=prod/);
    expect(() => parseDbMode(['MCO.exe', '--db'])).toThrow();
    expect(() => parseDbMode(['MCO.exe', '--db='])).toThrow();
  });

  it('ignores switches that merely start with --db', () => {
    expect(parseDbMode(['MCO.exe', '--dbus-stub'])).toEqual({ mode: 'prod', copyProd: false });
  });
});

describe('dev database files', () => {
  let profile: string;
  const prodFile = (): string => join(profile, DB_FILE_NAME);
  const devFile = (): string => join(dbDir(profile, 'dev'), DB_FILE_NAME);

  beforeEach(() => {
    profile = mkdtempSync(join(tmpdir(), 'mco-dbmode-'));
  });

  afterEach(() => {
    rmSync(profile, { recursive: true, force: true });
  });

  it('keeps prod in the profile folder and dev in its own subfolder', () => {
    expect(dbDir(profile, 'prod')).toBe(profile);
    expect(dbDir(profile, 'dev')).toBe(join(profile, 'dev'));
  });

  it('copies prod, with its write-ahead log, into a dev folder that does not exist yet', () => {
    writeFileSync(prodFile(), 'prod-main');
    writeFileSync(`${prodFile()}-wal`, 'prod-wal');

    expect(copyProdToDev(profile)).toBe(true);
    expect(readFileSync(devFile(), 'utf8')).toBe('prod-main');
    expect(readFileSync(`${devFile()}-wal`, 'utf8')).toBe('prod-wal');
    expect(readFileSync(prodFile(), 'utf8')).toBe('prod-main');
  });

  it('replaces an existing dev database, and drops its log', () => {
    mkdirSync(dbDir(profile, 'dev'), { recursive: true });
    writeFileSync(devFile(), 'dev-changes');
    writeFileSync(`${devFile()}-wal`, 'dev-wal');
    writeFileSync(`${devFile()}-shm`, 'dev-shm');
    writeFileSync(prodFile(), 'prod');

    expect(copyProdToDev(profile)).toBe(true);
    expect(readFileSync(devFile(), 'utf8')).toBe('prod');
    // The discarded dev database's log must not be replayed into the new copy.
    expect(existsSync(`${devFile()}-wal`)).toBe(false);
    expect(existsSync(`${devFile()}-shm`)).toBe(false);
  });

  it('leaves dev as it was when there is no prod database to copy', () => {
    expect(copyProdToDev(profile)).toBe(false);
    expect(existsSync(devFile())).toBe(false);

    mkdirSync(dbDir(profile, 'dev'), { recursive: true });
    writeFileSync(devFile(), 'dev-only');
    expect(copyProdToDev(profile)).toBe(false);
    expect(readFileSync(devFile(), 'utf8')).toBe('dev-only');
  });
});
