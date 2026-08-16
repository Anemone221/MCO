import { inspect } from 'node:util';

/**
 * In-memory capture of main-process console output, so "Export logs" on the
 * Settings page can produce a diagnostics file without a persistent log file
 * on disk. Keeps the most recent MAX_LINES lines of the current session.
 */
const MAX_LINES = 5000;

type LogLevel = 'log' | 'warn' | 'error';

const captured: string[] = [];

function formatArg(arg: unknown): string {
  if (typeof arg === 'string') return arg;
  if (arg instanceof Error) return arg.stack ?? String(arg);
  return inspect(arg, { depth: 3, breakLength: Infinity });
}

function record(level: LogLevel, args: unknown[]): void {
  const line = `${new Date().toISOString()} [${level.padEnd(5)}] ${args.map(formatArg).join(' ')}`;
  captured.push(line);
  if (captured.length > MAX_LINES) captured.splice(0, captured.length - MAX_LINES);
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

/** Everything captured this session, newest last. */
export function getCapturedLog(): string {
  return captured.join('\n');
}
