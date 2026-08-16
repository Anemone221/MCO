import { useEffect, useMemo, useRef, useState } from 'react';
import type { ShipInfo } from '@shared/types';
import { filterShipGroups, groupShips } from '../lib/shipBrowser';
import TypeIcon from './TypeIcon';

/**
 * Pick a hull to plan for: search by name, or open the ship group you have in
 * mind. Choosing one adds the skills that fly it (and everything they need) to
 * the plan and closes.
 *
 * A dialog rather than a third pane — a ship is chosen occasionally, and the
 * queue and the skill browser both want the width the rest of the time.
 */
export default function ShipBrowser({
  ships,
  onSelect,
  onClose,
}: {
  ships: ShipInfo[];
  onSelect: (ship: ShipInfo) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [openGroups, setOpenGroups] = useState<ReadonlySet<number>>(new Set());
  const searchRef = useRef<HTMLInputElement>(null);

  const groups = useMemo(() => groupShips(ships), [ships]);
  const visible = useMemo(() => filterShipGroups(groups, query), [groups, query]);
  const searching = query.trim().length > 0;

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Ship browser"
        data-testid="ship-browser"
      >
        <div className="bucket-head">
          <h3>Ship Browser</h3>
          <button type="button" className="ghost btn-sm" onClick={onClose}>
            Close
          </button>
        </div>
        <p className="muted">
          Pick a hull and every skill needed to fly it joins the plan, prerequisites included.
        </p>

        <input
          ref={searchRef}
          type="search"
          placeholder="Search ships…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          data-testid="ship-search"
        />

        <div className="table-scroll skill-browser modal__body">
          {visible.length === 0 ? (
            <p className="muted skill-browser__empty">
              {groups.length === 0
                ? 'No ship data — import static data from the Roster page.'
                : 'No ship matches that search.'}
            </p>
          ) : (
            visible.map((group) => (
              <details
                key={group.groupId}
                open={searching || openGroups.has(group.groupId)}
                onToggle={(e) => {
                  if (searching) return;
                  const open = (e.target as HTMLDetailsElement).open;
                  setOpenGroups((prev) => {
                    const next = new Set(prev);
                    if (open) next.add(group.groupId);
                    else next.delete(group.groupId);
                    return next;
                  });
                }}
                data-testid={`ship-group-${group.groupId}`}
              >
                <summary>
                  <span className="skill-browser__group">{group.name}</span>
                  <span className="muted">{group.ships.length}</span>
                </summary>
                <ul className="skill-browser__list">
                  {group.ships.map((ship) => (
                    <li key={ship.shipTypeId} className="skill-browser__skill">
                      <button
                        type="button"
                        className="plain ship-browser__pick"
                        onClick={() => onSelect(ship)}
                        data-testid={`ship-pick-${ship.shipTypeId}`}
                      >
                        <TypeIcon typeId={ship.shipTypeId} />
                        <span>{ship.name}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </details>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
