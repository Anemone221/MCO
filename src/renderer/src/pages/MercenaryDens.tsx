import { useMemo, useState, type MouseEvent } from 'react';
import { Link } from 'react-router-dom';
import type { EsiDataStatus, MercenaryDenEntry } from '@shared/types';
import { mco } from '../lib/ipc';
import { useMcoData } from '../lib/useMcoData';
import { formatDate, formatSecurity, formatTimeUntil, securityTier } from '../lib/format';
import {
  DEFAULT_MERCENARY_SORT,
  denLocation,
  denStatusChip,
  denStatusLabel,
  filterDens,
  formatMeter,
  nextMercenarySort,
  operationStatusChip,
  operationStatusLabel,
  sortDens,
  type MercenarySort,
  type MercenarySortKey,
} from '../lib/mercenaryView';
import CharacterAvatar from '../components/CharacterAvatar';
import StatTile from '../components/StatTile';
import { useCharacterContextMenu } from '../components/useCharacterContextMenu';

/** Calm, actionable copy for each non-ok ESI-data state — feature-agnostic. */
function statusLabel(status: EsiDataStatus, missingScopes: string[]): string | null {
  switch (status) {
    case 'ok':
      return null;
    case 'pending':
      return 'Not synced yet';
    case 'scope-missing':
      return `ESI scope required (${missingScopes.join(', ')}) — re-add this character to grant it`;
    case 'login-expired':
      return 'Login expired — re-add this character';
  }
}

const COLUMNS: Array<{ key: MercenarySortKey; label: string; numeric?: boolean }> = [
  { key: 'character', label: 'Character' },
  { key: 'location', label: 'Location' },
  { key: 'status', label: 'Status' },
  { key: 'development', label: 'Development', numeric: true },
  { key: 'anarchy', label: 'Anarchy', numeric: true },
  { key: 'infomorphs', label: 'Infomorphs', numeric: true },
  { key: 'operations', label: 'Ops', numeric: true },
  { key: 'timer', label: 'Reinforced until' },
];

/**
 * The operations standing at one den, as a sub-row.
 *
 * Nested rather than given a table of its own: an operation is only ever read
 * in the context of the den offering it, and a second top-level table would
 * make the reader join the two by eye.
 */
function OperationRows({ den }: { den: MercenaryDenEntry }) {
  if (den.operations.length === 0) {
    return (
      <tr className="subrow">
        <td colSpan={COLUMNS.length + 1} className="muted">
          No tactical operations on offer.
        </td>
      </tr>
    );
  }
  return (
    <>
      {den.operations.map((op) => (
        <tr key={op.operationId} className="subrow">
          <td />
          <td colSpan={2}>{op.dungeonName ?? `Dungeon ${op.dungeonTypeId ?? '—'}`}</td>
          <td colSpan={2}>
            <span className={operationStatusChip(op.status)}>
              {operationStatusLabel(op.status)}
            </span>
          </td>
          <td colSpan={4} className="muted">
            {op.expires === null ? '—' : `Expires ${formatTimeUntil(op.expires)}`}
          </td>
        </tr>
      ))}
    </>
  );
}

function DenRow({
  den,
  expanded,
  onToggle,
  onContextMenu,
}: {
  den: MercenaryDenEntry;
  expanded: boolean;
  onToggle: () => void;
  onContextMenu: (event: MouseEvent, characterId: number, characterName: string) => void;
}) {
  return (
    <>
      <tr data-testid={`den-row-${den.denId}`}>
        <td className="den-expand">
          <button
            type="button"
            className="den-expand__button"
            onClick={onToggle}
            aria-expanded={expanded}
            aria-label={expanded ? 'Hide operations' : 'Show operations'}
          >
            {expanded ? '▼' : '▶'}
          </button>
        </td>
        <td
          className="cell-with-avatar"
          onContextMenu={(e) => onContextMenu(e, den.characterId, den.characterName)}
          title="Right-click to assign tags or groups"
        >
          <CharacterAvatar characterId={den.characterId} size={20} />
          <Link to={`/character/${den.characterId}`}>{den.characterName}</Link>
          {den.accountLabel && <span className="muted"> · {den.accountLabel}</span>}
        </td>
        <td>
          {denLocation(den)}
          {den.systemName !== null && (
            <span className="muted">
              {' · '}
              <span className={`sec-${securityTier(den.security)}`}>
                {formatSecurity(den.security)}
              </span>{' '}
              {den.systemName}
              {den.regionName !== null && ` · ${den.regionName}`}
            </span>
          )}
        </td>
        <td>
          <span className={denStatusChip(den.status)}>{denStatusLabel(den.status)}</span>
        </td>
        <td className="num">{formatMeter(den.development)}</td>
        <td className="num">{formatMeter(den.anarchy)}</td>
        <td className="num">{den.infomorphs ?? '—'}</td>
        <td className="num">{den.openOperations > 0 ? den.openOperations : '—'}</td>
        <td className="time-left">
          {den.reinforcementEnd === null ? '—' : formatTimeUntil(den.reinforcementEnd)}
        </td>
      </tr>
      {expanded && <OperationRows den={den} />}
    </>
  );
}

export default function MercenaryDens() {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<MercenarySort>(DEFAULT_MERCENARY_SORT);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const { data, error, loading, setData, setError } = useMcoData(
    async () => {
      const [board, groups, tags] = await Promise.all([
        mco.mercenary.board(),
        mco.groups.list(),
        mco.tags.list(),
      ]);
      return { board, groups, tags };
    },
    { onCharactersChanged: true },
  );
  const { board = null, groups = [], tags = [] } = data ?? {};

  // Membership toggles don't change the dens, so only refresh tags/groups.
  const reloadOrg = async (): Promise<void> => {
    const [groups, tags] = await Promise.all([mco.groups.list(), mco.tags.list()]);
    setData((prev) => (prev ? { ...prev, groups, tags } : prev));
  };

  const { openMenu, menuElement } = useCharacterContextMenu({
    tags,
    groups,
    onChanged: reloadOrg,
    onError: setError,
  });

  const rows = useMemo(
    () => (board === null ? [] : sortDens(filterDens(board.dens, search), sort)),
    [board, search, sort],
  );

  const toggle = (denId: number): void =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(denId)) next.delete(denId);
      else next.add(denId);
      return next;
    });

  return (
    <section className="page">
      <div className="toolbar">
        <h2>Mercenary Dens</h2>
        <div className="toolbar__actions">
          <input
            type="search"
            placeholder="Filter dens…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Filter dens"
          />
        </div>
      </div>

      {error && (
        <div className="error-box" data-testid="mercenary-error">
          {error}
        </div>
      )}
      {loading && board === null && <p className="muted">Loading…</p>}

      {board !== null && (
        <>
          <div className="dashboard-tiles" data-testid="mercenary-tiles">
            <StatTile
              index={0}
              label="Dens"
              testId="tile-den-count"
              hint={`Held by ${board.totals.holders} character(s)`}
            >
              <div className="dashboard-tile__value">{board.totals.dens}</div>
            </StatTile>
            <StatTile
              index={1}
              label="Reinforced"
              testId="tile-den-reinforced"
              hint="Dens with a reinforcement timer still running"
            >
              <div className="dashboard-tile__value">{board.totals.reinforced}</div>
            </StatTile>
            <StatTile
              index={2}
              label="Disabled"
              testId="tile-den-disabled"
              hint="Dens the owning character can no longer operate — earning nothing"
            >
              <div className="dashboard-tile__value">{board.totals.disabled}</div>
            </StatTile>
            <StatTile
              index={3}
              label="High anarchy"
              testId="tile-den-anarchy"
              hint={
                'Dens at anarchy level 2 or above, where the skyhook starts losing workforce.\nRunning the den’s tactical operations is what brings it back down.'
              }
            >
              <div className="dashboard-tile__value">{board.totals.highAnarchy}</div>
            </StatTile>
            <StatTile
              index={4}
              label="Open operations"
              testId="tile-den-operations"
              hint="Tactical operations available or already started across every den"
            >
              <div className="dashboard-tile__value">{board.totals.openOperations}</div>
            </StatTile>
          </div>

          {board.totals.dens === 0 ? (
            <p className="muted" data-testid="mercenary-empty">
              No Mercenary Dens on record.{' '}
              {board.reportingCharacters === 0
                ? 'No character has granted the scopes that report them yet — re-add a character to grant them.'
                : `${board.reportingCharacters} character(s) can report dens; none of them holds one.`}
            </p>
          ) : (
            <div className="table-scroll">
              <table className="data-table" data-testid="mercenary-table">
                <thead>
                  <tr>
                    <th aria-label="Expand" />
                    {COLUMNS.map((column) => (
                      <th
                        key={column.key}
                        className={`sortable${column.numeric === true ? ' num' : ''}`}
                        onClick={() => setSort(nextMercenarySort(sort, column.key))}
                      >
                        {column.label}
                        {sort.key === column.key && (
                          <span className="sort-arrow">{sort.dir === 'asc' ? '▲' : '▼'}</span>
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((den) => (
                    <DenRow
                      key={den.denId}
                      den={den}
                      expanded={expanded.has(den.denId)}
                      onToggle={() => toggle(den.denId)}
                      onContextMenu={openMenu}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {board.unresolvedPlanets > 0 && (
            <p className="muted">
              {board.unresolvedPlanets} den(s) still show a planet id instead of a name — the
              lookup runs on the next sync.
            </p>
          )}

          {board.coverage.length > 0 && (
            <details className="clone-block">
              <summary>
                {board.coverage.length} character(s) cannot report dens or operations
              </summary>
              <ul className="result-list">
                {board.coverage.map((entry) => (
                  <li key={entry.characterId}>
                    <Link to={`/character/${entry.characterId}`}>{entry.characterName}</Link>{' '}
                    <span className="muted">
                      — {statusLabel(entry.status, entry.missingScopes)}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}

          {board.dens.length > 0 && (
            <p className="muted">
              Last read {formatDate(board.dens[0]?.updatedAt ?? null)}.
            </p>
          )}
        </>
      )}

      {menuElement}
    </section>
  );
}
