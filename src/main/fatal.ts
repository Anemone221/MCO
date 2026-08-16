import { app, dialog } from 'electron';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { closeDb } from './db';
import { buildDiagnosticsText } from './services/settingsService';

/**
 * Last-resort handler for an uncaught exception in the main process.
 *
 * Without one the process simply vanishes: the window disappears with no
 * message, and *Settings → Export logs* — the only way to get at this session's
 * log — went with it. So the log is written out here, unattended, before a
 * dialog that names the file. That file is the whole point; the dialog just
 * tells the user where to find it.
 *
 * Unhandled *rejections* stay non-fatal (`log.ts` logs them and the process
 * carries on). With ~90 characters syncing, one rejected background promise
 * must not take the app down.
 */

/** A failure while reporting a failure must not re-enter this handler. */
let handling = false;

/** Timestamp for a crash filename, e.g. 20260716-143207. */
function crashStamp(): string {
  const now = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  );
}

/** Write the crash report next to the profile database. Returns its path, or null. */
function writeCrashReport(): string | null {
  try {
    const target = join(app.getPath('userData'), `mco-crash-${crashStamp()}.txt`);
    // Synchronous on purpose: the process is on its way out, and an async write
    // queued behind a dying event loop may never reach the disk.
    writeFileSync(target, buildDiagnosticsText('MCO crash report'), 'utf8');
    return target;
  } catch (err) {
    console.error('[fatal] could not write the crash report:', err);
    return null;
  }
}

/**
 * Copy for the crash dialog. The one-line summary is deliberate — the stack is
 * in the report file, and a modal full of frames tells the user less than the
 * path to the file they can actually send on.
 */
export function fatalErrorMessage(err: unknown, reportPath: string | null): string {
  const summary = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return [
    'MCO hit an error it could not recover from and has to close.',
    '',
    summary,
    '',
    reportPath
      ? `A report with this session's log was saved to:\n${reportPath}`
      : 'The crash report could not be written; the details are in the console output only.',
  ].join('\n');
}

function onUncaughtException(err: unknown): void {
  if (handling) return;
  handling = true;

  // Log first so the crash itself is in the buffer the report is built from.
  console.error('[fatal] uncaught exception in the main process:', err);
  const reportPath = writeCrashReport();

  try {
    dialog.showErrorBox('MCO has stopped', fatalErrorMessage(err, reportPath));
  } catch (dialogErr) {
    console.error('[fatal] could not show the crash dialog:', dialogErr);
  }

  try {
    // Checkpoints the WAL. Skipping it would be survivable — SQLite recovers a
    // hot journal on the next open — but a clean close costs nothing here.
    closeDb();
  } catch {
    // Already broken; terminating matters more than tidying up.
  }

  // exit() rather than quit(): quit() runs the normal teardown path, which is
  // the code that just proved it can throw. The DB is already closed above.
  app.exit(1);
}

/** Install the uncaught-exception handler. Idempotent. */
export function initFatalErrorHandler(): void {
  process.off('uncaughtException', onUncaughtException);
  process.on('uncaughtException', onUncaughtException);
}
