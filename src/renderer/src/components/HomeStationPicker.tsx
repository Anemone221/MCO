import { useState } from 'react';
import { mco } from '../lib/ipc';
import { useDebouncedSearch } from '../lib/useDebouncedSearch';

/**
 * Type-ahead over imported structures to pick a group's home station.
 * Once set, shows the station name with a Clear button instead of the input.
 */
export default function HomeStationPicker({
  current,
  disabled,
  onSelect,
}: {
  current: { id: number; name: string } | null;
  disabled: boolean;
  onSelect: (station: { id: number; name: string } | null) => void;
}) {
  const [query, setQuery] = useState('');
  const { results, active } = useDebouncedSearch(query, mco.structures.search);

  if (current) {
    return (
      <div className="station-picker__current" data-testid="home-station-current">
        <span title={current.name}>{current.name}</span>
        <button
          type="button"
          className="ghost btn-sm"
          disabled={disabled}
          onClick={() => onSelect(null)}
          data-testid="home-station-clear"
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
        placeholder="Search structures…"
        value={query}
        disabled={disabled}
        onChange={(e) => setQuery(e.target.value)}
        data-testid="home-station-search"
      />
      {active && (
        <div className="station-picker__results" data-testid="home-station-results">
          {results.length === 0 ? (
            <span className="station-picker__empty muted">
              No imported structure matches — import structures on the Location page.
            </span>
          ) : (
            results.map((hit) => (
              <button
                key={hit.structureId}
                type="button"
                className="station-picker__option"
                disabled={disabled}
                onClick={() => {
                  setQuery('');
                  onSelect({ id: hit.structureId, name: hit.name });
                }}
                data-testid={`home-station-option-${hit.structureId}`}
              >
                {hit.name}
                {hit.systemName && <span className="muted"> — {hit.systemName}</span>}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
