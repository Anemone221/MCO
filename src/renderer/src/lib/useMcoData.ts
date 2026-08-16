import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { errorMessage, mco } from './ipc';

export interface UseMcoDataOptions {
  /**
   * Re-load when one of these changes — route params (`[fitId]`, `[groupId]`, …).
   * Treated as an effect dependency list, so its length must be constant.
   */
  deps?: unknown[];
  /** Also re-load when a background sync sweep updates character data. */
  onCharactersChanged?: boolean;
}

export interface McoData<T> {
  /** `null` until the first load resolves; keeps its last value on failure. */
  data: T | null;
  error: string | null;
  loading: boolean;
  /** Re-run the loader (after a mutation, or from a Refresh button). */
  reload: () => Promise<void>;
  /** Patch the loaded data in place, to skip an expensive re-fetch. */
  setData: Dispatch<SetStateAction<T | null>>;
  /** Show a failure that didn't come from the loader (a mutation, a partial sync). */
  setError: Dispatch<SetStateAction<string | null>>;
}

/**
 * The one way a page loads data from the main process: runs `load` on mount,
 * again whenever `deps` change, and (optionally) whenever a background sync
 * sweep lands. Pages must not hand-roll this — a new data source is a channel
 * in `src/shared/ipc.ts` plus a call to this hook, never another copy of the
 * useState/useEffect/try-catch machine.
 *
 * A run that has been superseded (a sweep firing mid-load, StrictMode's double
 * mount, a route param changing) is discarded rather than raced, so the newest
 * request always wins regardless of which response lands first.
 *
 * `load` is read from a ref, so it does *not* need to be a `useCallback` — an
 * inline arrow is fine, and cannot spin the effect.
 */
export function useMcoData<T>(
  load: () => Promise<T>,
  options: UseMcoDataOptions = {},
): McoData<T> {
  const { deps = [], onCharactersChanged = false } = options;

  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // The freshest loader closure, so `reload` stays stable while still seeing
  // the current props/state a caller captured in it.
  const loadRef = useRef(load);
  loadRef.current = load;
  // Only the newest run may write state; `alive` drops the results of a run
  // that outlived its page.
  const runId = useRef(0);
  const alive = useRef(true);

  const reload = useCallback(async () => {
    const id = ++runId.current;
    const current = (): boolean => alive.current && id === runId.current;
    setLoading(true);
    setError(null);
    try {
      const next = await loadRef.current();
      if (current()) setData(next);
    } catch (e) {
      // Stale data stays on screen; the message says why it stopped updating.
      if (current()) setError(errorMessage(e));
    } finally {
      if (current()) setLoading(false);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void reload();
    const unsubscribe = onCharactersChanged
      ? mco.characters.onChanged(() => void reload())
      : null;
    return () => {
      alive.current = false;
      unsubscribe?.();
    };
    // `load` is deliberately absent — see loadRef above.
  }, [reload, onCharactersChanged, ...deps]);

  return { data, error, loading, reload, setData, setError };
}
