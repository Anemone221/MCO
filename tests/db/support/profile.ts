import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach } from 'vitest';
import { closeDb } from '@main/db';
import { openedUrls, setOpenExternal, setUserDataDir } from './electron';

/**
 * Give every test in the calling file its own empty profile folder, so
 * `getDb()` opens a brand-new database and runs every migration on it.
 * Returns a getter for the folder.
 */
export function useFreshProfile(): () => string {
  let dir = '';

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mco-dbtest-'));
    setUserDataDir(dir);
    openedUrls.length = 0;
    setOpenExternal(null);
  });

  afterEach(() => {
    closeDb();
    setUserDataDir(null);
    // Windows can hold the WAL files a moment after close; a leftover temp
    // folder is not worth failing a test over.
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    } catch {
      // left for the OS to clean up
    }
  });

  return () => dir;
}
