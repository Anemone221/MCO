import { inspect } from 'node:util';
import { RotatingLogFile } from './logFile';

/**
 * Capture of main-process console output, in two places.
 *
 * In memory: the most recent MAX_LINES lines of the current session, always
 * available. On disk, once {@link attachLogFile} has been called: the same
 * lines appended to a size-capped rotating file in the profile folder (see
 * `logFile.ts`), so "Export logs" can show what happened before the last
 * restart and not only since it.
 */
const MAX_LINES = 5000;
/** How long lines wait before being written; one small write a second at most. */
const FLUSH_INTERVAL_MS = 1000;

type LogLevel = 'log' | 'warn' | 'error';

const captured: string[] = [];

let logFile: RotatingLogFile | null = null;
/** Lines recorded since the last flush. */
let unwritten: string[] = [];
let flushTimer: NodeJS.Timeout | null = null;

function formatArg(arg: unknown): string {
  if (typeof arg === 'string') return arg;
  if (arg instanceof Error) return arg.stack ?? String(arg);
  return inspect(arg, { depth: 3, breakLength: Infinity });
}

function record(level: LogLevel, args: unknown[]): void {
  const line = `${new Date().toISOString()} [${level.padEnd(5)}] ${args.map(formatArg).join(' ')}`;
  captured.push(line);
  if (captured.length > MAX_LINES) captured.splice(0, captured.length - MAX_LINES);

  if (logFile) {
    unwritten.push(line);
    if (!flushTimer) {
      flushTimer = setTimeout(flushLogFile, FLUSH_INTERVAL_MS);
      // Never the reason the process stays alive; quit and crash flush by hand.
      flushTimer.unref();
    }
  }
}

let initialized = false;

/** Patch console.log/warn/error to also record into the export buffer. Idempotent. */
export function initLogCapture(): void {
  if (initialized) return;
  initialized = true;

  for (const level of ['log', 'warn', 'error'] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      record(level, args);
      original(...args);
    };
  }

  // Via the patched console rather than record() directly, so a rejection is
  // *visible* — printed to a dev terminal as it happens — instead of only
  // surfacing later in an exported log. Registering this listener is also what
  // keeps an unhandled rejection non-fatal: Node's default since v15 is to
  // rethrow it, which `fatal.ts` would then treat as a crash.
  process.on('unhandledRejection', (reason) => {
    console.error('[unhandledRejection]', reason);
  });

  record('log', ['[mco] log capture started']);
}

/**
 * Start writing the log to `dir` as well. Lines captured before this call are
 * written first, behind a marker naming the session, so the file reads as a
 * sequence of runs. Idempotent.
 *
 * A log that cannot be written must never take the app down or recurse into
 * itself: any failure here or in a later flush switches the file off for the
 * rest of the session and leaves one line saying so in the in-memory buffer.
 */
export function attachLogFile(dir: string, sessionLabel: string): void {
  if (logFile) return;
  try {
    logFile = new RotatingLogFile(dir);
    unwritten = [`==== ${sessionLabel} — session started ${new Date().toISOString()} ====`, ...captured];
    flushLogFile();
  } catch (err) {
    disableLogFile(err);
  }
}

/**
 * Write any lines still waiting. Synchronous on purpose: it is called from the
 * quit path and the crash handler, where a write queued behind a dying event
 * loop may never reach the disk.
 */
export function flushLogFile(): void {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (!logFile || unwritten.length === 0) return;
  const lines = unwritten;
  unwritten = [];
  try {
    logFile.append(lines);
  } catch (err) {
    disableLogFile(err);
  }
}

function disableLogFile(err: unknown): void {
  logFile = null;
  unwritten = [];
  // record(), not console.error: with the file switched off this only reaches
  // the in-memory buffer, and it cannot loop back into a failing write.
  record('warn', ['[log] the log file is unavailable; logging to memory only:', err]);
}

/** Everything captured this session, newest last. */
export function getCapturedLog(): string {
  return captured.join('\n');
}

/**
 * The log file's contents — earlier sessions first, then this one — or null
 * when there is no file (not attached, or switched off after a write failed).
 */
export function getPersistedLog(): string | null {
  flushLogFile();
  if (!logFile) return null;
  try {
    return logFile.readAll();
  } catch {
    return null;
  }
}
