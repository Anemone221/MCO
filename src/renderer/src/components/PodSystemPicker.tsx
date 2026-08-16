import { useState } from 'react';
import { mco } from '../lib/ipc';
import { useDebouncedSearch } from '../lib/useDebouncedSearch';
import { formatSecurity, securityTier } from '../lib/format';

/**
 * Type-ahead over SDE solar systems to add entries to the pod whitelist.
 * Unlike the home-station picker the input stays put after a pick — the
 * whitelist usually holds more than one system.
 */
export default function PodSystemPicker({
  excludeIds,
  disabled,
  onSelect,
}: {
  excludeIds: Set<number>;
  disabled: boolean;
  onSelect: (system: { id: number; name: string }) => void;
}) {
  const [query, setQuery] = useState('');
  const { results, active } = useDebouncedSearch(query, mco.systems.search);

  const options = results.filter((hit) => !excludeIds.has(hit.solarSystemId));

  return (
    <div className="station-picker pod-whitelist__picker">
      <input
        type="search"
        placeholder="Add system…"
        value={query}
        disabled={disabled}
        onChange={(e) => setQuery(e.target.value)}
        data-testid="pod-system-search"
      />
      {active && (
        <div className="station-picker__results" data-testid="pod-system-results">
          {options.length === 0 ? (
            <span className="station-picker__empty muted">
              No matching system — static data with map info may need importing (top of the
              Roster page).
            </span>
          ) : (
            options.map((hit) => (
              <button
                key={hit.solarSystemId}
                type="button"
                className="station-picker__option"
                disabled={disabled}
                onClick={() => {
                  setQuery('');
                  onSelect({ id: hit.solarSystemId, name: hit.name });
                }}
                data-testid={`pod-system-option-${hit.solarSystemId}`}
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
