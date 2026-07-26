import { useEffect, useRef, useState } from 'react';
import { ROSTER_COLUMNS, type ColumnVisibility, type RosterColumnKey } from '../lib/rosterView';

/**
 * "Columns" dropdown for the Roster table. Lets the user show/hide any column
 * except Character, which is always shown (rendered as a disabled, checked row).
 * Closes on outside click or Escape, mirroring RosterContextMenu.
 */
export default function ColumnPicker({
  visibility,
  onToggle,
}: {
  visibility: ColumnVisibility;
  onToggle: (key: RosterColumnKey) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="column-picker" ref={ref}>
      <button
        type="button"
        className="ghost"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        data-testid="roster-column-picker"
      >
        Columns
      </button>
      {open && (
        <div className="column-picker__panel" role="menu">
          <label className="column-picker__item column-picker__item--locked">
            <input type="checkbox" checked disabled />
            Character
          </label>
          {ROSTER_COLUMNS.map((col) => (
            <label key={col.key} className="column-picker__item">
              <input
                type="checkbox"
                checked={visibility[col.key]}
                onChange={() => onToggle(col.key)}
                data-testid={`column-toggle-${col.key}`}
              />
              {col.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
