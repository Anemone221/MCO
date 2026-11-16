import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

const root = import.meta.dirname;

/**
 * The database-backed suite: real SQLite, real migrations, real repositories
 * and services, with only Electron and the network stubbed.
 *
 * Separate from `vitest.config.ts` because it cannot run under plain Node —
 * better-sqlite3 is built for Electron — so `npm run test:db` starts it inside
 * Electron's Node instead (see `scripts/test-db.mjs`).
 */
export default defineConfig({
  resolve: {
    alias: {
      '@main': resolve(root, 'src/main'),
      '@shared': resolve(root, 'src/shared'),
      '@renderer': resolve(root, 'src/renderer/src'),
      // Main-process modules import `electron` for the profile path, token
      // encryption and the browser hand-off; the stub stands in for all three.
      electron: resolve(root, 'tests/db/support/electron.ts'),
    },
  },
  test: {
    include: ['tests/db/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['tests/db/support/setup.ts'],
    // Child processes rather than worker threads: a native module is loaded
    // once per process, and each file gets its own.
    pool: 'forks',
  },
});
