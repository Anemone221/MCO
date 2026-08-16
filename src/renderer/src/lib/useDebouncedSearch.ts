import { useEffect, useRef, useState } from 'react';

/** Keystrokes to absorb before hitting the DB. */
const DEBOUNCE_MS = 200;
/** Shorter than this a query matches half the SDE — not worth searching. */
const MIN_QUERY_LENGTH = 2;

export interface DebouncedSearch<T> {
  /** Hits for the current query; empty while it is too short to search. */
  results: T[];
  /** The query is long enough to have searched — show the results panel. */
  active: boolean;
}

/**
 * The type-ahead half of a picker: debounces `query`, runs `search` against the
 * main process, and drops the answer if the query moved on. Callers own the
 * input and the markup; this owns the timing.
 *
 * `search` is read from a ref, so an inline arrow cannot re-trigger the effect.
 */
export function useDebouncedSearch<T>(
  query: string,
  search: (needle: string) => Promise<T[]>,
): DebouncedSearch<T> {
  const [results, setResults] = useState<T[]>([]);
  const searchRef = useRef(search);
  searchRef.current = search;

  const needle = query.trim();
  const active = needle.length >= MIN_QUERY_LENGTH;

  useEffect(() => {
    if (!active) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void searchRef.current(needle)
        // A failed lookup reads as "no matches" — a type-ahead has nowhere to
        // put an error message, and the picker's empty copy already says what
        // to do when nothing matches.
        .catch(() => [] as T[])
        .then((hits) => {
          if (!cancelled) setResults(hits);
        });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [needle, active]);

  return { results, active };
}
