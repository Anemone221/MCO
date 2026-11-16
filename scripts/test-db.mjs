/* global process, console */
// Runs the database-backed suite (tests/db) inside Electron's own Node.
//
// better-sqlite3 is a native module and `npm install` builds it for Electron's
// ABI (the postinstall step), so plain `node` cannot load it. Rather than keep a
// second build of it around for tests, vitest is started with the Electron
// binary in ELECTRON_RUN_AS_NODE mode: the suite then exercises the exact
// binary the app ships with, on every platform, with no rebuild step.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
/** In plain Node, requiring `electron` yields the path of its executable. */
const electronBinary = require('electron');
// The CLI entry is not in vitest's export map, so it is found beside its package.json.
const vitestEntry = join(dirname(require.resolve('vitest/package.json')), 'vitest.mjs');

const result = spawnSync(
  electronBinary,
  [vitestEntry, 'run', '--config', 'vitest.db.config.ts', ...process.argv.slice(2)],
  { stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } },
);
if (result.error) {
  console.error(result.error);
  process.exit(1);
}
process.exit(result.status ?? 1);
