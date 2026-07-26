import type { EsiActivityEvent, EsiActivitySummary } from '@shared/types';
import { rateLimiter } from './rate-limiter';

/**
 * Structured, ESI-specific diagnostics: running counters for every request
 * outcome plus a ring buffer of only the *noteworthy* events (throttles,
 * retries, timeouts, give-ups, backoff windows, sweeps).
 *
 * Deliberately separate from the generic console capture (`src/main/log.ts`):
 * a 90+ character sweep makes ~1k requests, so recording every success as a
 * line would drown the signal. Here successes are counted, not logged; only
 * anomalies land in the event buffer. Both feed the Settings "Export logs"
 * diagnostics file and a live activity readout.
 *
 * In-memory and session-scoped, matching the app's no-persistent-log
 * convention. Counters are cumulative for the current run.
 */

/** Successful requests slower than this are flagged as a `slow` event. */
const SLOW_REQUEST_MS = 10_000;
/** Most recent events retained; older ones are dropped (anomalies only, so this is generous). */
const MAX_EVENTS = 2000;
/** Default number of recent events returned to the live UI readout. */
const DEFAULT_RECENT = 50;

interface Counters {
  since: string;
  requests: number;
  cacheFresh: number;
  ok200: number;
  notModified304: number;
  unauthorized401: number;
  throttled420: number;
  throttled429: number;
  serverError5xx: number;
  otherError: number;
  timeouts: number;
  networkErrors: number;
  giveUps: number;
  backoffWindows: number;
  totalBackoffSeconds: number;
  maxBackoffSeconds: number;
  slowRequests: number;
}

function freshCounters(): Counters {
  return {
    since: new Date().toISOString(),
    requests: 0,
    cacheFresh: 0,
    ok200: 0,
    notModified304: 0,
    unauthorized401: 0,
    throttled420: 0,
    throttled429: 0,
    serverError5xx: 0,
    otherError: 0,
    timeouts: 0,
    networkErrors: 0,
    giveUps: 0,
    backoffWindows: 0,
    totalBackoffSeconds: 0,
    maxBackoffSeconds: 0,
    slowRequests: 0,
  };
}

let counters = freshCounters();
const events: EsiActivityEvent[] = [];

/** A request was skipped because a fresh cache entry answered it. */
export function recordCacheFresh(): void {
  counters.cacheFresh += 1;
}

/** Tally one network response by its HTTP status. Call exactly once per response. */
export function recordStatus(status: number): void {
  counters.requests += 1;
  if (status === 200) counters.ok200 += 1;
  else if (status === 304) counters.notModified304 += 1;
  else if (status === 401) counters.unauthorized401 += 1;
  else if (status === 420) counters.throttled420 += 1;
  else if (status === 429) counters.throttled429 += 1;
  else if (status >= 500) counters.serverError5xx += 1;
  else counters.otherError += 1;
}

/** A successful request whose round-trip exceeded {@link SLOW_REQUEST_MS}. No-op if under. */
export function recordSlow(event: Omit<EsiActivityEvent, 'at' | 'kind'>): void {
  if ((event.ms ?? 0) < SLOW_REQUEST_MS) return;
  counters.slowRequests += 1;
  pushEvent({ kind: 'slow', ...event });
}

/**
 * Record a noteworthy event into the ring buffer and update the counters it
 * implies (timeouts, network errors, give-ups, backoff totals). Status-code
 * tallies are owned by {@link recordStatus}, not here, so the two never
 * double-count.
 */
export function recordEvent(event: Omit<EsiActivityEvent, 'at'>): void {
  switch (event.kind) {
    case 'timeout':
      counters.timeouts += 1;
      break;
    case 'network-error':
      counters.networkErrors += 1;
      break;
    case 'give-up':
      counters.giveUps += 1;
      break;
    case 'backoff':
      counters.backoffWindows += 1;
      counters.totalBackoffSeconds += event.backoffSeconds ?? 0;
      counters.maxBackoffSeconds = Math.max(counters.maxBackoffSeconds, event.backoffSeconds ?? 0);
      break;
    default:
      break;
  }
  pushEvent(event);
}

function pushEvent(event: Omit<EsiActivityEvent, 'at'>): void {
  events.push({ at: new Date().toISOString(), ...event });
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
}

/** Snapshot for the live Settings readout (recent events truncated). */
export function getEsiActivity(recentLimit = DEFAULT_RECENT): EsiActivitySummary {
  return {
    since: counters.since,
    requests: counters.requests,
    cacheFresh: counters.cacheFresh,
    status: {
      ok200: counters.ok200,
      notModified304: counters.notModified304,
      unauthorized401: counters.unauthorized401,
      throttled420: counters.throttled420,
      throttled429: counters.throttled429,
      serverError5xx: counters.serverError5xx,
      otherError: counters.otherError,
    },
    timeouts: counters.timeouts,
    networkErrors: counters.networkErrors,
    giveUps: counters.giveUps,
    backoffWindows: counters.backoffWindows,
    totalBackoffSeconds: counters.totalBackoffSeconds,
    maxBackoffSeconds: counters.maxBackoffSeconds,
    slowRequests: counters.slowRequests,
    currentBackoffSeconds: Math.ceil(rateLimiter.backoffMs / 1000),
    recentEvents: events.slice(-recentLimit),
  };
}

/** Reset all counters and events. Test-only. */
export function resetEsiLog(): void {
  counters = freshCounters();
  events.length = 0;
}

function fmtEvent(e: EsiActivityEvent): string {
  const parts = [e.at, `[${e.kind}]`];
  if (e.path) parts.push(e.path);
  if (e.characterId !== undefined) parts.push(`char=${e.characterId}`);
  if (e.status !== undefined) parts.push(`status=${e.status}`);
  if (e.ms !== undefined) parts.push(`ms=${e.ms}`);
  if (e.attempt !== undefined) parts.push(`attempt=${e.attempt}`);
  if (e.backoffSeconds !== undefined) parts.push(`backoff=${e.backoffSeconds}s`);
  if (e.detail) parts.push(`— ${e.detail}`);
  return parts.join(' ');
}

/** Render the full ESI diagnostics block (counters + every retained event) for the export file. */
export function formatEsiDiagnostics(): string {
  const c = counters;
  const lines = [
    `Since:        ${c.since}`,
    `Requests:     ${c.requests} network  (+${c.cacheFresh} served from fresh cache)`,
    `Statuses:     200=${c.ok200}  304=${c.notModified304}  401→refresh=${c.unauthorized401}  ` +
      `420=${c.throttled420}  429=${c.throttled429}  5xx=${c.serverError5xx}  other-4xx=${c.otherError}`,
    `Failures:     timeouts=${c.timeouts}  network-errors=${c.networkErrors}  give-ups=${c.giveUps}  slow=${c.slowRequests}`,
    `Backoff:      ${c.backoffWindows} window(s), ${c.totalBackoffSeconds}s total, longest ${c.maxBackoffSeconds}s` +
      (rateLimiter.backoffMs > 0 ? `  (active now: ~${Math.ceil(rateLimiter.backoffMs / 1000)}s)` : ''),
    '',
    events.length === 0
      ? '(no throttles, retries, timeouts or give-ups recorded this session)'
      : `Events (oldest first, up to ${MAX_EVENTS}):`,
    ...events.map(fmtEvent),
  ];
  return lines.join('\n');
}
