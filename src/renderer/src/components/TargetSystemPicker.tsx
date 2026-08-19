import { useState } from 'react';
import type { SystemSearchResult } from '@shared/types';
import { mco } from '../lib/ipc';
import { useDebouncedSearch } from '../lib/useDebouncedSearch';
import { formatSecurity, securityTier } from '../lib/format';

/**
 * Type-ahead over SDE solar systems that names the system a proximity search
 * measures against — "who is closest to *here*".
 *
 * Once a system is picked the input gives way to the system itself with a
 * Clear button, like the home-station picker: a ranking only means anything
 * against one target at a time, and the chosen one has to stay legible while
 * the results below it are read.
 */
export default function TargetSystemPicker({
  current,
  onSelect,
}: {
  current: SystemSearchResult | null;
  onSelect: (system: SystemSearchResult | null) => void;
}) {
  const [query, setQuery] = useState('');
  const { results, active } = useDebouncedSearch(query, mco.systems.search);

  if (current) {
    return (
      <div className="nearest-target" data-testid="target-system-current">
        <span>
          Nearest to{' '}
          <span className={`sec-${securityTier(current.security)}`}>
            {formatSecurity(current.security)}
          </span>{' '}
          <strong>{current.name}</strong>
          {current.regionName && <span className="muted"> · {current.regionName}</span>}
        </span>
        <button
          type="button"
          className="ghost btn-sm"
          onClick={() => onSelect(null)}
          data-testid="target-system-clear"
        >
          Clear
        </button>
      </div>
    );
  }

  return (
    <div className="station-picker">
      <input
        type="search"
        placeholder="Nearest to system…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        data-testid="target-system-search"
      />
      {active && (
        <div className="station-picker__results" data-testid="target-system-results">
          {results.length === 0 ? (
            <span className="station-picker__empty muted">
              No matching system — static data with map info may need importing (banner at
              the top of the page).
            </span>
          ) : (
            results.map((hit) => (
              <button
                key={hit.solarSystemId}
                type="button"
                className="station-picker__option"
                onClick={() => {
                  setQuery('');
                  onSelect(hit);
                }}
                data-testid={`target-system-option-${hit.solarSystemId}`}
              >
                <span className={`sec-${securityTier(hit.security)}`}>
                  {formatSecurity(hit.security)}
                </span>{' '}
                {hit.name}
                {hit.regionName && <span className="muted"> · {hit.regionName}</span>}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
