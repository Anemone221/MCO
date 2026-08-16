/**
 * Collapse concurrent work on the same key into one shared promise.
 *
 * Written for token refresh, where a duplicate call is not merely wasteful but
 * destructive: EVE SSO rotates the refresh token on every exchange, so two
 * refreshes racing on one character send the same token twice and the loser
 * presents one SSO has already consumed. The single-instance lock keeps two
 * *processes* apart; this keeps two callers inside one process apart.
 *
 * Keys are held only while their task is in flight — the entry is dropped once
 * it settles, so a later call starts fresh work rather than replaying a stale
 * result. Failures propagate to every caller that joined.
 */
export interface SingleFlight<K, V> {
  /** Run `task` for `key`, or join the run already in flight for it. */
  run(key: K, task: () => Promise<V>): Promise<V>;
  /** How many keys are in flight. For tests and diagnostics. */
  readonly size: number;
}

export function createSingleFlight<K, V>(): SingleFlight<K, V> {
  const inFlight = new Map<K, Promise<V>>();

  return {
    run(key, task) {
      const joined = inFlight.get(key);
      if (joined) return joined;

      // The async wrapper matters: a task that throws *synchronously* would
      // otherwise escape before the entry is registered, leaving the key stuck.
      const started = (async () => task())().finally(() => {
        inFlight.delete(key);
      });
      inFlight.set(key, started);
      return started;
    },
    get size() {
      return inFlight.size;
    },
  };
}
