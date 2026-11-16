import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { mco } from '../lib/ipc';
import { useMcoData } from '../lib/useMcoData';
import {
  buildPaletteItems,
  KIND_LABEL,
  searchPalette,
  type PaletteItem,
  type PaletteSources,
} from '../lib/commandPalette';

/**
 * Ctrl+K quick search: jump to any page, character, group, fit or plan — or run
 * "Sync all" — without going through the Roster. Mounted only while open, so
 * its lists load fresh each time it opens and cost nothing otherwise.
 *
 * Keyboard: type to filter, ↑/↓ to move, Enter to open, Esc to close.
 */
export default function CommandPalette({
  pages,
  onClose,
}: {
  pages: PaletteSources['pages'];
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const { data, error } = useMcoData(async () => {
    const [roster, fits, plans, groups] = await Promise.all([
      mco.characters.roster(),
      mco.fits.list(),
      mco.plans.list(),
      mco.groups.list(),
    ]);
    return { roster, fits, plans, groups };
  });

  const items = useMemo(
    () =>
      buildPaletteItems({
        pages,
        characters: (data?.roster ?? []).map((r) => ({
          id: r.character.id,
          name: r.character.name,
          accountLabel: r.accountLabel,
        })),
        fits: data?.fits ?? [],
        plans: data?.plans ?? [],
        groups: (data?.groups ?? []).map((g) => ({
          id: g.id,
          name: g.name,
          memberCount: g.characterIds.length,
        })),
      }),
    [pages, data],
  );
  const results = useMemo(() => searchPalette(items, query), [items, query]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // A new query starts the highlight back at the best match.
  useEffect(() => {
    setActive(0);
  }, [query]);

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  function choose(item: PaletteItem | undefined): void {
    if (!item) return;
    onClose();
    if (item.to !== undefined) {
      navigate(item.to);
    } else if (item.action === 'sync-all') {
      // Progress shows in the activity indicator at the bottom of the window.
      mco.characters.syncAll().catch((e: unknown) => console.error('[palette] sync all failed', e));
    }
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (results.length === 0 ? 0 : (i + 1) % results.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (results.length === 0 ? 0 : (i - 1 + results.length) % results.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(results[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }

  const activeId = results[active] ? `palette-item-${active}` : undefined;

  return (
    <div
      className="modal-backdrop palette-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal palette"
        role="dialog"
        aria-modal="true"
        aria-label="Quick search"
        data-testid="command-palette"
      >
        <input
          ref={inputRef}
          type="search"
          className="palette__input"
          placeholder="Jump to a character, group, fit, plan or page…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-results"
          aria-activedescendant={activeId}
          aria-autocomplete="list"
          data-testid="palette-input"
        />
        {error && <p className="error palette__note">{error}</p>}
        <ul id="palette-results" ref={listRef} className="palette__list" role="listbox">
          {results.length === 0 ? (
            <li className="palette__empty muted">No matches</li>
          ) : (
            results.map((item, index) => (
              <li
                key={item.key}
                id={`palette-item-${index}`}
                data-index={index}
                role="option"
                aria-selected={index === active}
                className={index === active ? 'palette__item palette__item--active' : 'palette__item'}
                onMouseMove={() => setActive(index)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(item)}
                data-testid={`palette-item-${item.key}`}
              >
                <span className="palette__label">{item.label}</span>
                {item.detail && <span className="palette__detail">{item.detail}</span>}
                <span className="palette__kind">{KIND_LABEL[item.kind]}</span>
              </li>
            ))
          )}
        </ul>
        <p className="palette__hint muted">
          <kbd>↑</kbd> <kbd>↓</kbd> move · <kbd>Enter</kbd> open · <kbd>Esc</kbd> close ·{' '}
          <kbd>/</kbd> or <kbd>Ctrl</kbd>+<kbd>F</kbd> focuses a page&apos;s search
        </p>
      </div>
    </div>
  );
}
