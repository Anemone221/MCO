import { useEffect, useMemo, useRef, useState } from 'react';
import type { Tag } from '@shared/types';
import { mco } from '../lib/ipc';
import { sectionTagCoverage } from '../lib/tags';

/**
 * Bulk capability tagging for a fit/plan result section. An anchored dropdown
 * (mirrors ColumnPicker's open/close behaviour) that assigns one tag to every
 * character currently in the section in a single action — the "everyone who can
 * fly this can Cyno" setup workflow. Clicking an existing tag applies it; a new
 * capability can be created and applied inline. Each tag shows how many of the
 * section already hold it, so re-tagging during setup is obvious. Closes on
 * outside click or Escape.
 */
export default function BulkTagBar({
  tags,
  characterIds,
  onApplied,
  onError,
  testId,
}: {
  tags: Tag[];
  /** Every character in the section this bar sits on. */
  characterIds: number[];
  /** Called after a successful apply so the page can reload tag membership. */
  onApplied: () => void | Promise<void>;
  onError?: (message: string) => void;
  testId?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState('');

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
  const coverage = useMemo(
    () => sectionTagCoverage(tags, characterIds),
    [tags, characterIds],
  );

  async function run(action: () => Promise<unknown>): Promise<void> {
    setBusy(true);
    try {
      await action();
      await onApplied();
      setNewName('');
      setOpen(false);
    } catch (e) {
      onError?.(String(e));
    } finally {
      setBusy(false);
    }
  }

  function applyExisting(tag: Tag): void {
    void run(() => mco.tags.addMembers(tag.id, characterIds));
  }

  function createAndApply(): void {
    const name = newName.trim();
    if (!name) return;
    void run(async () => {
      const tag = await mco.tags.create(name);
      await mco.tags.addMembers(tag.id, characterIds);
    });
  }

  if (count === 0) return null;

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
        + Assign tag
      </button>
      {open && (
        <div className="bulk-tag__panel" role="menu">
          <div className="bulk-tag__hint">
            Assign a capability to all {count} character{count === 1 ? '' : 's'} in this section.
          </div>
          {tags.length > 0 && (
            <div className="bulk-tag__list">
              {tags.map((tag) => {
                const held = coverage.get(tag.id) ?? 0;
                return (
                  <button
                    key={tag.id}
                    type="button"
                    className="context-menu__item context-menu__item--button"
                    disabled={busy}
                    onClick={() => applyExisting(tag)}
                    data-testid={testId ? `${testId}-tag-${tag.id}` : undefined}
                  >
                    <span
                      className="context-menu__dot"
                      style={{ background: tag.color ?? 'var(--muted)' }}
                    />
                    <span className="bulk-tag__name">{tag.name}</span>
                    {held > 0 && (
                      <span className="bulk-tag__held">
                        {held === count ? '✓ all' : `${held}/${count}`}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
          <div className="bulk-tag__new">
            <input
              value={newName}
              placeholder="New capability…"
              disabled={busy}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') createAndApply();
              }}
              data-testid={testId ? `${testId}-new` : undefined}
            />
            <button
              type="button"
              className="btn-sm"
              disabled={busy || newName.trim().length === 0}
              onClick={createAndApply}
              data-testid={testId ? `${testId}-create` : undefined}
            >
              Create &amp; assign
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
