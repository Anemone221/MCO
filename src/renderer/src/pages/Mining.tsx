import { useCallback, useMemo, useState, type MouseEvent } from 'react';
import { Link } from 'react-router-dom';
import type { MiningSummary } from '@shared/types';
import { mco } from '../lib/ipc';
import { useMcoData } from '../lib/useMcoData';
import { formatDayLabel, formatSecurity, formatVolumeExact, securityTier } from '../lib/format';
import {
  DEFAULT_MINING_SORT,
  MINING_BREAKDOWNS,
  barColumn,
  barPercent,
  barValue,
  filterMiningRows,
  formatMiningValue,
  miningColumns,
  miningMetric,
  miningRows,
  nextMiningSort,
  sortMiningRows,
  type MiningBreakdown,
  type MiningSort,
  type MiningViewRow,
} from '../lib/miningView';
import MiningByDayChart from '../components/charts/MiningByDayChart';
import CharacterAvatar from '../components/CharacterAvatar';
import StatTile from '../components/StatTile';
import TypeIcon from '../components/TypeIcon';
import { useCharacterContextMenu } from '../components/useCharacterContextMenu';

/**
 * How far back the page looks. Day-grained, because the ledger is: ESI reports
 * mining aggregated per UTC day, so anything finer would be invented. "All"
 * reaches past ESI's own ~30-day horizon into what past sweeps banked.
 */
const PERIODS: Array<{ id: string; days: number | null; label: string }> = [
  { id: '1', days: 1, label: 'Today' },
  { id: '7', days: 7, label: '7 days' },
  { id: '30', days: 30, label: '30 days' },
  { id: 'all', days: null, label: 'All' },
];

const PERIOD_KEY = 'mco-mining-period';

function loadPeriod(): string {
  try {
    const stored = localStorage.getItem(PERIOD_KEY);
    return PERIODS.some((p) => p.id === stored) && stored !== null ? stored : '30';
  } catch {
    return '30';
  }
}

function storePeriod(id: string): void {
  try {
    localStorage.setItem(PERIOD_KEY, id);
  } catch {
    // A profile with storage blocked just loses the preference.
  }
}

/** The name cell, which is the one cell that differs between the breakdowns. */
function NameCell({
  row,
  breakdown,
  onContextMenu,
}: {
  row: MiningViewRow;
  breakdown: MiningBreakdown;
  onContextMenu: (event: MouseEvent, characterId: number, characterName: string) => void;
}) {
  const characterId = row.characterId;
  if (breakdown === 'character' && characterId !== null) {
    return (
      <td
        className="cell-with-avatar"
        onContextMenu={(e) => onContextMenu(e, characterId, row.label)}
        title="Right-click to assign tags or groups"
      >
        <CharacterAvatar characterId={characterId} size={20} />
        <Link to={`/character/${characterId}`}>{row.label}</Link>
      </td>
    );
  }
  if (breakdown === 'ore' && row.typeId !== null) {
    return (
      <td className="cell-with-avatar">
        <TypeIcon typeId={row.typeId} size={20} />
        {row.label}
      </td>
    );
  }
  return (
    <td>
      <span className={`sec-${securityTier(row.security)}`}>{formatSecurity(row.security)}</span>{' '}
      {row.label}
    </td>
  );
}

export default function Mining() {
  const [periodId, setPeriodId] = useState(loadPeriod);
  const [breakdown, setBreakdown] = useState<MiningBreakdown>('character');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<MiningSort>(DEFAULT_MINING_SORT);

  const period = PERIODS.find((p) => p.id === periodId) ?? PERIODS[2]!;

  const { data, error, loading, reload, setData, setError } = useMcoData(
    async () => {
      const [summary, groups, tags] = await Promise.all([
        mco.mining.summary(period.days),
        mco.groups.list(),
        mco.tags.list(),
      ]);
      return { summary, groups, tags };
    },
    { deps: [period.days], onCharactersChanged: true },
  );
  const { summary = null, groups = [], tags = [] } = data ?? {};

  // Membership toggles don't change the ledger, so only refresh tags/groups.
  const reloadOrg = useCallback(async () => {
    const [groups, tags] = await Promise.all([mco.groups.list(), mco.tags.list()]);
    setData((prev) => (prev ? { ...prev, groups, tags } : prev));
  }, [setData]);

  const { openMenu, menuElement } = useCharacterContextMenu({
    tags,
    groups,
    onChanged: reloadOrg,
    onError: setError,
  });

  const metric = summary ? miningMetric(summary) : 'volume';
  const columns = useMemo(() => miningColumns(breakdown, metric), [breakdown, metric]);
  const barKey = barColumn(metric);

  const rows = useMemo(
    () =>
      summary === null
        ? []
        : sortMiningRows(filterMiningRows(miningRows(summary, breakdown), search), sort),
    [summary, breakdown, search, sort],
  );
  const maxBar = useMemo(
    () => rows.reduce((max, row) => Math.max(max, barValue(row, metric)), 0),
    [rows, metric],
  );

  function selectPeriod(id: string): void {
    storePeriod(id);
    setPeriodId(id);
  }

  return (
    <section className="page">
      <div className="toolbar">
        <h2>Mining</h2>
        <div className="tab-bar tab-bar--inline" role="tablist" aria-label="Period">
          {PERIODS.map((p) => (
            <button
              key={p.id}
              type="button"
              role="tab"
              aria-selected={p.id === periodId}
              className={`tab${p.id === periodId ? ' tab--active' : ''}`}
              data-testid={`mining-period-${p.id}`}
              onClick={() => selectPeriod(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>
        <button type="button" className="ghost" onClick={() => void reload()} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div className="error-box" data-testid="mining-error">
          {error}
        </div>
      )}

      {summary && (
        <>
          <div className="dashboard-tiles" data-testid="mining-tiles">
            <StatTile
              index={0}
              label={metric === 'units' ? 'Units mined' : 'Volume mined'}
              testId="tile-mining-volume"
              hint={
                (metric === 'volume' ? `${formatVolumeExact(summary.totals.volumeM3)} · ` : '') +
                `${summary.totals.units.toLocaleString()} units · ${windowLabel(summary)}`
              }
            >
              <div className="dashboard-tile__value">
                {formatMiningValue(metric, metric === 'units' ? summary.totals.units : summary.totals.volumeM3)}
              </div>
            </StatTile>
            <StatTile
              index={1}
              label="Ore types"
              testId="tile-mining-ores"
              hint="Distinct ore, ice and gas types mined in this window"
            >
              <div className="dashboard-tile__value">{summary.totals.oreTypes}</div>
            </StatTile>
            <StatTile
              index={2}
              label="Characters mining"
              testId="tile-mining-characters"
              hint={`${summary.reportingCharacters} character(s) can report mining`}
            >
              <div className="dashboard-tile__value">{summary.totals.characters}</div>
            </StatTile>
            <StatTile
              index={3}
              label="Systems"
              testId="tile-mining-systems"
              hint="Distinct solar systems mined in this window"
            >
              <div className="dashboard-tile__value">{summary.totals.systems}</div>
            </StatTile>
          </div>

          <MiningNotices summary={summary} />

          {summary.byDay.length > 1 && summary.totals.units > 0 && (
            <div className="card chart-card" data-testid="mining-chart">
              <h3>Mined by day</h3>
              <MiningByDayChart series={summary.byDay} metric={metric} />
            </div>
          )}

          <div className="filter-bar">
            <div className="tab-bar tab-bar--inline" role="tablist" aria-label="Breakdown">
              {MINING_BREAKDOWNS.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  role="tab"
                  aria-selected={b.id === breakdown}
                  className={`tab${b.id === breakdown ? ' tab--active' : ''}`}
                  data-testid={`mining-breakdown-${b.id}`}
                  onClick={() => setBreakdown(b.id)}
                >
                  {b.label}
                </button>
              ))}
            </div>
            <input
              type="search"
              placeholder="Search…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              data-testid="mining-search"
            />
            <span className="filter-bar__count">
              {rows.length.toLocaleString()} row{rows.length === 1 ? '' : 's'}
            </span>
          </div>

          <div className="table-scroll">
            <table className="data-table" data-testid="mining-table">
              <thead>
                <tr>
                  {columns.map((col) => (
                    <th
                      key={col.key}
                      className={col.numeric ? 'sortable num' : 'sortable'}
                      title={col.title}
                      aria-sort={
                        sort.key === col.key
                          ? sort.dir === 'asc'
                            ? 'ascending'
                            : 'descending'
                          : undefined
                      }
                      onClick={() => setSort((prev) => nextMiningSort(prev, col.key))}
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
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={columns.length} className="no-matches">
                      {loading
                        ? 'Loading…'
                        : search
                          ? 'No rows match the search.'
                          : 'No mining recorded in this window.'}
                    </td>
                  </tr>
                )}
                {rows.map((row) => (
                  <tr key={row.key}>
                    {columns.map((col) => {
                      if (col.key === 'label') {
                        return (
                          <NameCell
                            key={col.key}
                            row={row}
                            breakdown={breakdown}
                            onContextMenu={openMenu}
                          />
                        );
                      }
                      if (col.key === 'sublabel') {
                        return (
                          <td key={col.key} className={row.sublabel ? undefined : 'muted'}>
                            {row.sublabel ?? '—'}
                          </td>
                        );
                      }
                      if (col.key === 'volume' || col.key === 'units') {
                        const text =
                          col.key === 'units'
                            ? row.units.toLocaleString()
                            : formatVolumeExact(row.volumeM3);
                        // The bar is the row's share of the biggest row, drawn
                        // behind the figure: the ranking reads at a glance
                        // without giving 90 characters 90 chart bars.
                        if (col.key !== barKey) {
                          return (
                            <td key={col.key} className="num">
                              {text}
                            </td>
                          );
                        }
                        return (
                          <td key={col.key} className="num mining-bar-cell">
                            <span
                              className="mining-bar"
                              style={{ width: `${barPercent(barValue(row, metric), maxBar)}%` }}
                              aria-hidden="true"
                            />
                            <span className="mining-bar__value">{text}</span>
                          </td>
                        );
                      }
                      if (col.key === 'extra') {
                        return (
                          <td key={col.key} className={col.numeric ? 'num' : undefined}>
                            {row.extra === null
                              ? '—'
                              : breakdown === 'character'
                                ? formatDayLabel(row.extra.text)
                                : row.extra.text}
                          </td>
                        );
                      }
                      const count = col.key === 'countB' ? row.countB : row.countA;
                      return (
                        <td key={col.key} className="num">
                          {count === null ? '—' : count.toLocaleString()}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {menuElement}
    </section>
  );
}

/** "1–30 Aug" style description of what the totals cover. */
function windowLabel(summary: MiningSummary): string {
  if (summary.window.days === 1) return `${formatDayLabel(summary.window.endDay)} (UTC)`;
  const start =
    summary.window.days === null
      ? (summary.firstRecordedDay ?? summary.window.endDay)
      : summary.window.startDay;
  return `${formatDayLabel(start)} – ${formatDayLabel(summary.window.endDay)} (UTC)`;
}

/**
 * The two things that make the numbers on this page a floor rather than a
 * total: characters whose token cannot report mining at all, and ore the
 * imported static data has no volume for. Both are one action away from fixed,
 * so both say which action.
 */
function MiningNotices({ summary }: { summary: MiningSummary }) {
  const total = summary.coverage.length + summary.reportingCharacters;
  const expired = summary.coverage.filter((c) => c.status === 'login-expired');
  const scopeGap = summary.coverage.filter((c) => c.status === 'scope-missing');

  return (
    <>
      {scopeGap.length > 0 && (
        <div className="creator-notice" data-testid="mining-scope-notice">
          {scopeGap.length === total ? (
            <>
              No character can report mining yet. The mining ledger needs a scope added after
              these characters were, so each one has to be re-added once (Roster → Add
              character, same character) to grant it.
            </>
          ) : (
            <>
              {scopeGap.length} of {total} characters lack the mining scope, so their mining is
              missing here — re-add each one to grant it:{' '}
              {scopeGap.slice(0, 8).map((c, index) => (
                <span key={c.characterId}>
                  {index > 0 && ', '}
                  <Link to={`/character/${c.characterId}`}>{c.characterName}</Link>
                </span>
              ))}
              {scopeGap.length > 8 && ` and ${scopeGap.length - 8} more`}.
            </>
          )}
        </div>
      )}

      {expired.length > 0 && (
        <div className="creator-notice" data-testid="mining-expired-notice">
          {expired.length} character{expired.length === 1 ? "'s" : "s'"} login has expired, so
          their mining stopped updating — re-add them to resume.
        </div>
      )}

      {summary.typesMissingVolume > 0 && (
        <div className="creator-notice" data-testid="mining-volume-notice">
          {summary.typesMissingVolume} mined type
          {summary.typesMissingVolume === 1 ? ' has' : 's have'} no volume in the imported static
          data, so {summary.totals.volumeM3 === 0 ? 'the m³ figures are unavailable' : 'every m³ figure below is short'}
          . Re-import static data from the banner at the top of the app to fill them in.
        </div>
      )}
    </>
  );
}
