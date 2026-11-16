/**
 * Whether background work should go to the network right now.
 *
 * Nothing here blocks a request. The ESI client reports what it saw, and the
 * loops that run unattended — the hourly sweep, live tracking, the waves of a
 * fleet sync — ask before starting, so a laptop that is offline or asleep on
 * a train stays quiet instead of spending every character's retry budget and
 * filling the log with "sync failed", while a sync the user clicks still runs.
 *
 * Two signals:
 *
 * - **The OS's own view** (Electron's `net.isOnline()`, injected through
 *   {@link useOnlineProbe}). False means there is no route to anything, so a
 *   tick could only fail.
 * - **A run of network failures with no response between them** (connection
 *   refused, DNS, timeouts). The OS can report a network that leads nowhere —
 *   a captive portal, a VPN that dropped — so {@link PAUSE_AFTER_FAILURES}
 *   consecutive failures pause background work for {@link PAUSE_MS}. The first
 *   response of any status clears the run and the pause: a 403 still proves
 *   the network is there.
 *
 * Dependency-free so the rules are unit-tested with an injected clock.
 */

/** Consecutive request failures that open a pause. Two requests' worth of retries. */
export const PAUSE_AFTER_FAILURES = 8;
/** How long background work stays paused after such a run. */
export const PAUSE_MS = 5 * 60 * 1000;

export type BlockedReason = 'offline' | 'paused';

export class ConnectivityGate {
  private consecutiveFailures = 0;
  private pausedUntil = 0;
  private onlineProbe: () => boolean = () => true;
  /** Last answer given, so a transition is logged once rather than every 20 s. */
  private lastReported: BlockedReason | null = null;

  constructor(private readonly now: () => number = Date.now) {}

  /** Where "is there a network at all" comes from — `net.isOnline` in the app. */
  useOnlineProbe(probe: () => boolean): void {
    this.onlineProbe = probe;
  }

  /** A request got no response at all: refused, unresolvable, or timed out. */
  noteNetworkFailure(): void {
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= PAUSE_AFTER_FAILURES) {
      this.pausedUntil = this.now() + PAUSE_MS;
      // Counted afresh, so a pause is extended only by another full run.
      this.consecutiveFailures = 0;
    }
  }

  /** A response arrived, whatever its status: the network is there. */
  noteResponse(): void {
    this.consecutiveFailures = 0;
    this.pausedUntil = 0;
  }

  /** Why background work should wait, or null to go ahead. */
  blockedReason(): BlockedReason | null {
    if (!this.onlineProbe()) return 'offline';
    if (this.now() < this.pausedUntil) return 'paused';
    return null;
  }

  /** When a pause ends, or null when none is open (or the OS says offline). */
  pausedUntilIso(): string | null {
    return this.blockedReason() === 'paused' ? new Date(this.pausedUntil).toISOString() : null;
  }

  /**
   * {@link blockedReason} for a loop: true when its tick should be skipped,
   * with one log line per change of state so a 20-second loop that is offline
   * for an hour writes two lines, not 180.
   */
  shouldSkip(what: string): boolean {
    const reason = this.blockedReason();
    if (reason !== this.lastReported) {
      if (reason === 'offline') {
        console.log(`[net] offline; ${what} and other background work will wait for the network`);
      } else if (reason === 'paused') {
        console.log(
          `[net] ${PAUSE_AFTER_FAILURES} requests in a row got no response; ` +
            `${what} and other background work pause until ${new Date(this.pausedUntil).toISOString()}`,
        );
      } else {
        console.log(`[net] network is back; ${what} resumes`);
      }
      this.lastReported = reason;
    }
    return reason !== null;
  }

  /** Back to the starting state (tests). */
  reset(): void {
    this.consecutiveFailures = 0;
    this.pausedUntil = 0;
    this.lastReported = null;
  }
}

/** The app's one gate: fed by `esi/client.ts`, consulted by the scheduler and live tracking. */
export const connectivity = new ConnectivityGate();
