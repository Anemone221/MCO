import { useEffect, useMemo, useRef, useState } from 'react';
import { sectionTagCoverage } from '../lib/tags';

/** What the menu needs from a tag or a group. */
interface MembershipItem {
  id: number;
  name: string;
  color: string | null;
  characterIds: number[];
}

/**
 * Add a set of characters to — or take them out of — a tag or group, from the
 * Roster's bulk bar. An anchored dropdown (same open/close behaviour as
 * BulkTagBar) listing every tag or group with how many of the selection already
 * hold it, and an Add and a Remove button each. It stays open after an action
 * so several capabilities can be handed out in one visit. Closes on outside
 * click or Escape.
 */
export default function BulkMembershipMenu({
  label,
  items,
  emptyText,
  characterIds,
  busy,
  onAdd,
  onRemove,
  testId,
}: {
  label: string;
  items: MembershipItem[];
  emptyText: string;
  /** The characters an Add or Remove applies to. */
  characterIds: number[];
  busy: boolean;
  onAdd: (itemId: number) => void;
  onRemove: (itemId: number) => void;
  testId: string;
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

  const count = characterIds.length;
  const coverage = useMemo(() => sectionTagCoverage(items, characterIds), [items, characterIds]);

  return (
    <div className="bulk-tag" ref={ref}>
      <button
        type="button"
        className="ghost btn-sm"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        data-testid={testId}
      >
        {label} ▾
      </button>
      {open && (
        <div className="bulk-tag__panel bulk-tag__panel--left" role="menu">
          {items.length === 0 ? (
            <div className="context-menu__empty">{emptyText}</div>
          ) : (
            <div className="bulk-tag__list">
              {items.map((item) => {
                const held = coverage.get(item.id) ?? 0;
                return (
                  <div key={item.id} className="context-menu__item bulk-member__row">
                    <span
                      className="context-menu__dot"
                      style={{ background: item.color ?? 'var(--muted)' }}
                    />
                    <span className="bulk-tag__name">{item.name}</span>
                    <span className="bulk-tag__held">
                      {held}/{count}
                    </span>
                    <button
                      type="button"
                      className="ghost btn-sm"
                      disabled={busy || held === count}
                      onClick={() => onAdd(item.id)}
                      data-testid={`${testId}-add-${item.id}`}
                    >
                      Add
                    </button>
                    <button
                      type="button"
                      className="ghost btn-sm"
                      disabled={busy || held === 0}
                      onClick={() => onRemove(item.id)}
                      data-testid={`${testId}-remove-${item.id}`}
                    >
                      Remove
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
