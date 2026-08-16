import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type {
  BlueprintBoard,
  BlueprintCatalogEntry,
  BlueprintCharacterCoverage,
  BlueprintCorpStatus,
} from '@shared/types';
import { errorMessage, mco } from '../lib/ipc';
import { useMcoData } from '../lib/useMcoData';
import { formatDate } from '../lib/format';
import {
  DEFAULT_BLUEPRINT_SORT,
  NO_BLUEPRINT_FILTERS,
  blueprintCategories,
  countOwned,
  filterBlueprints,
  isOwned,
  metaGroupLabel,
  sortBlueprints,
  type BlueprintFilters,
  type BlueprintSort,
  type BlueprintSortKey,
  type OwnershipFilter,
} from '../lib/blueprintView';

const EMPTY_BOARD: BlueprintBoard = {
  needsBlueprintData: false,
  entries: [],
  totals: { seededTotal: 0, allTotal: 0, untracked: 0 },
  characters: [],
  corps: [],
};

interface Column {
  key: BlueprintSortKey;
  label: string;
  numeric?: boolean;
}

const COLUMNS: Column[] = [
  { key: 'name', label: 'Blueprint' },
  { key: 'category', label: 'Category' },
  { key: 'group', label: 'Group' },
  { key: 'tech', label: 'Tech' },
  { key: 'owned', label: 'Own', numeric: true },
  { key: 'me', label: 'ME', numeric: true },
  { key: 'te', label: 'TE', numeric: true },
  { key: 'holders', label: 'Held by' },
];

function percent(owned: number, total: number): string {
  if (total === 0) return '—';
  return `${Math.round((owned / total) * 100)}%`;
}

/**
 * The checklist tick. A check mark means "you hold an original of this" — the
 * whole point of a BPO checklist, so copies never earn one while
 * "Originals only" is on. With it off a copies-only blueprint ticks muted, so
 * the two readings stay visually distinct instead of collapsing into one mark.
 */
function OwnedTick({
  entry,
  originalsOnly,
}: {
  entry: BlueprintCatalogEntry;
  originalsOnly: boolean;
}) {
  // One rule, shared with the owned/missing filter, so a row can never be
  // ticked here and counted as missing there.
  if (!isOwned(entry, originalsOnly)) return <span className="muted">—</span>;
  if (entry.originals === 0) {
    return (
      <span className="bp-tick bp-tick--copy" title={`${entry.copies} copies, no original`}>
        ✓<span className="bp-tick__count">c</span>
      </span>
    );
  }
  return (
    <span className="bp-tick" title={`${entry.originals} original${entry.originals > 1 ? 's' : ''}`}>
      ✓{entry.originals > 1 && <span className="bp-tick__count">×{entry.originals}</span>}
    </span>
  );
}

/** Held-by cell: names, with a count-only fallback once a blueprint is stockpiled. */
function Holders({ entry }: { entry: BlueprintCatalogEntry }) {
  if (entry.holders.length === 0) return <span className="muted">—</span>;
  if (entry.holders.length > 3) {
    return (
      <span title={entry.holders.map((h) => h.name).join(', ')}>
        {entry.holders.length} holders
      </span>
    );
  }
  return (
    <span className="bp-holders">
      {entry.holders.map((holder) => (
        <span
          key={`${holder.kind}:${holder.id}`}
          className={holder.kind === 'corporation' ? 'chip chip--corp' : 'chip'}
        >
          {holder.name}
        </span>
      ))}
    </span>
  );
}

function CorpCard({
  corp,
  onRemove,
}: {
  corp: BlueprintCorpStatus;
  onRemove: () => void;
}) {
  return (
    <div className="card bp-corp" data-testid={`bp-corp-${corp.corporationId}`}>
      <h3>
        {corp.name ?? `Corporation ${corp.corporationId}`}
        {corp.ticker && <span className="muted"> [{corp.ticker}]</span>}
      </h3>
      <p className="muted">
        {corp.originals.toLocaleString()} originals · read by{' '}
        {corp.readerCharacterName ?? `character ${corp.readerCharacterId}`}
        {corp.syncedAt ? ` · ${formatDate(corp.syncedAt)}` : ' · not read yet'}
      </p>
      {corp.lastError && (
        <p className="status-pill status-pill--scope-missing">{corp.lastError}</p>
      )}
      <button type="button" className="ghost btn-sm" onClick={onRemove}>
        Stop tracking
      </button>
    </div>
  );
}

/** Characters whose token cannot report blueprints, so the count is knowably short. */
function coverageGap(characters: BlueprintCharacterCoverage[]): BlueprintCharacterCoverage[] {
  return characters.filter((c) => c.status === 'scope-missing' || c.status === 'login-expired');
}

export default function Blueprints() {
  const [busy, setBusy] = useState(false);
  const [filters, setFilters] = useState<BlueprintFilters>(NO_BLUEPRINT_FILTERS);
  const [sort, setSort] = useState<BlueprintSort>(DEFAULT_BLUEPRINT_SORT);
  const [showCoverage, setShowCoverage] = useState(false);

  const { data, error, loading, reload, setData, setError } = useMcoData(
    () => mco.blueprints.board(),
    { onCharactersChanged: true },
  );
  const board: BlueprintBoard = data ?? EMPTY_BOARD;

  /** Re-read the tracked corp hangars now, ignoring their failure cooldown. */
  const refresh = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setData(await mco.blueprints.refresh());
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }, [setData, setError]);

  const addCorp = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setData(await mco.blueprints.addCorp());
    } catch (e) {
      setError(errorMessage(e));
      // A corp that could not be read is still tracked, so its card (carrying
      // the same reason, and a way to stop tracking it) belongs on screen.
      await reload();
    } finally {
      setBusy(false);
      setShowCoverage(true);
    }
  }, [reload, setData, setError]);

  const removeCorp = useCallback(
    async (corp: BlueprintCorpStatus) => {
      const ok = await mco.system.confirm(
        `Stop tracking ${corp.name ?? `corporation ${corp.corporationId}`}? Its blueprints leave the checklist.`,
        'Stop tracking',
      );
      if (!ok) return;
      try {
        await mco.blueprints.removeCorp(corp.corporationId);
        await reload();
      } catch (e) {
        setError(errorMessage(e));
      }
    },
    [reload, setError],
  );

  const categories = useMemo(() => blueprintCategories(board.entries), [board.entries]);
  const visible = useMemo(
    () => sortBlueprints(filterBlueprints(board.entries, filters), sort),
    [board.entries, filters, sort],
  );

  const gap = useMemo(() => coverageGap(board.characters), [board.characters]);
  const reporting = board.characters.filter((c) => c.status === 'ok').length;

  const { owned, total } = useMemo(() => countOwned(board.entries, filters), [board.entries, filters]);

  function toggleSort(key: BlueprintSortKey): void {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : // Counts and research levels are most useful highest-first.
          { key, dir: key === 'owned' || key === 'me' || key === 'te' ? 'desc' : 'asc' },
    );
  }

  function set<K extends keyof BlueprintFilters>(key: K, value: BlueprintFilters[K]): void {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <section className="page">
      <div className="toolbar">
        <h2>Blueprints</h2>
        <button type="button" className="ghost" onClick={() => void refresh()} disabled={busy || loading}>
          {busy ? 'Working…' : 'Refresh'}
        </button>
        <button
          type="button"
          className="ghost"
          onClick={() => void addCorp()}
          disabled={busy}
          title="Sign in with a Director of your alt corp to read its blueprint hangar"
          data-testid="bp-add-corp"
        >
          Track alt corp
        </button>
      </div>

      {error && (
        <div className="error-box" data-testid="blueprints-error">
          {error}
        </div>
      )}

      {board.needsBlueprintData ? (
        <div className="empty-state">
          <h3>No blueprint data</h3>
          <p>
            Import (or re-import) the static data export — the checklist needs the SDE&apos;s
            blueprint list to know which blueprints exist.
          </p>
        </div>
      ) : (
        <>
          <div className="stats-strip">
            <span className="stat-chip" data-testid="bp-owned">
              <strong>
                {owned.toLocaleString()} / {total.toLocaleString()}
              </strong>{' '}
              owned ({percent(owned, total)})
            </span>
            <span className="stat-chip">
              <strong>{(total - owned).toLocaleString()}</strong> missing
            </span>
            {board.totals.untracked > 0 && (
              <span className="stat-chip" title="Originals held whose blueprint type is no longer published">
                <strong>{board.totals.untracked.toLocaleString()}</strong> off-catalog
              </span>
            )}
            <span className={gap.length > 0 ? 'stat-chip stat-chip--warn' : 'stat-chip'}>
              <strong>
                {reporting} / {board.characters.length}
              </strong>{' '}
              characters reporting
            </span>
            <button
              type="button"
              className="ghost btn-sm"
              onClick={() => setShowCoverage((v) => !v)}
              data-testid="bp-coverage-toggle"
            >
              {showCoverage ? 'Hide sources' : 'Sources'}
            </button>
          </div>

          {showCoverage && (
            <div className="detail-grid" data-testid="bp-coverage">
              {board.corps.map((corp) => (
                <CorpCard
                  key={corp.corporationId}
                  corp={corp}
                  onRemove={() => void removeCorp(corp)}
                />
              ))}
              {board.corps.length === 0 && (
                <div className="card">
                  <h3>No alt corp tracked</h3>
                  <p className="muted">
                    Blueprints parked in an alt corp&apos;s hangar are invisible to a character
                    token. “Track alt corp” signs one Director in with the corporation blueprint
                    scope; nothing else about the corp is read.
                  </p>
                </div>
              )}
              <div className="card">
                <h3>Characters</h3>
                {gap.length === 0 ? (
                  <p className="muted">Every character can report its blueprints.</p>
                ) : (
                  <ul className="result-list">
                    {gap.map((c) => (
                      <li key={c.characterId}>
                        <span className="result-row">
                          <Link to={`/character/${c.characterId}`}>{c.characterName}</Link>
                          <span className="muted">
                            {c.status === 'login-expired'
                              ? 'login expired — re-add'
                              : 'blueprint scope missing — re-add'}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          <div className="filter-bar">
            <input
              type="search"
              placeholder="Search blueprint, group, or holder…"
              value={filters.search}
              onChange={(e) => set('search', e.target.value)}
              data-testid="bp-search"
            />
            <select
              value={filters.category}
              onChange={(e) => set('category', e.target.value)}
              data-testid="bp-category"
            >
              <option value="all">All categories</option>
              {categories.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <select
              value={filters.ownership}
              onChange={(e) => set('ownership', e.target.value as OwnershipFilter)}
              data-testid="bp-ownership"
            >
              <option value="all">Owned &amp; missing</option>
              <option value="owned">Owned</option>
              <option value="missing">Missing</option>
            </select>
            <label
              className="muted"
              title="Only a blueprint original ticks a row. Off: blueprints you hold only as copies tick too."
            >
              <input
                type="checkbox"
                checked={filters.originalsOnly}
                onChange={(e) => set('originalsOnly', e.target.checked)}
                data-testid="bp-originals-only"
              />{' '}
              Originals only
            </label>
            <label className="muted" title="Tech II/III and faction blueprints that only ever exist as copies">
              <input
                type="checkbox"
                checked={filters.includeCopyOnly}
                onChange={(e) => set('includeCopyOnly', e.target.checked)}
                data-testid="bp-copy-only"
              />{' '}
              Include copy-only
            </label>
            <span className="filter-bar__count">
              {visible.length !== board.entries.length
                ? `${visible.length.toLocaleString()} of ${board.entries.length.toLocaleString()}`
                : `${board.entries.length.toLocaleString()} blueprints`}
            </span>
          </div>

          <div className="table-scroll">
            <table className="data-table" data-testid="blueprints-table">
              <thead>
                <tr>
                  {COLUMNS.map((col) => (
                    <th
                      key={col.key}
                      className={col.numeric ? 'sortable num' : 'sortable'}
                      aria-sort={
                        sort.key === col.key
                          ? sort.dir === 'asc'
                            ? 'ascending'
                            : 'descending'
                          : undefined
                      }
                      onClick={() => toggleSort(col.key)}
                    >
                      {col.label}
                      {sort.key === col.key && (
                        <span className="sort-arrow">{sort.dir === 'asc' ? '▲' : '▼'}</span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.length === 0 && (
                  <tr>
                    <td colSpan={COLUMNS.length} className="no-matches">
                      No blueprints match the current filters.
                    </td>
                  </tr>
                )}
                {visible.map((entry) => (
                  <tr
                    key={entry.typeId}
                    className={entry.originals === 0 ? 'bp-row--missing' : undefined}
                    data-testid={`bp-row-${entry.typeId}`}
                  >
                    <td>{entry.name}</td>
                    <td className="muted">{entry.categoryName ?? '—'}</td>
                    <td className="muted">{entry.groupName ?? '—'}</td>
                    <td className="muted">{metaGroupLabel(entry.metaGroupId)}</td>
                    <td className="num">
                      <OwnedTick entry={entry} originalsOnly={filters.originalsOnly} />
                      {entry.originals > 0 && entry.copies > 0 && (
                        <span className="muted" title={`${entry.copies} copies`}>
                          {' '}
                          +{entry.copies}c
                        </span>
                      )}
                    </td>
                    <td className="num">
                      {entry.bestMaterialEfficiency ?? <span className="muted">—</span>}
                    </td>
                    <td className="num">
                      {entry.bestTimeEfficiency ?? <span className="muted">—</span>}
                    </td>
                    <td>
                      <Holders entry={entry} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
