import { useCallback, useEffect, useMemo, useState, type MouseEvent } from 'react';
import { Link } from 'react-router-dom';
import type { LocationEntry, NearestCharacterEntry, SystemSearchResult } from '@shared/types';
import { errorMessage, mco } from '../lib/ipc';
import { useMcoData } from '../lib/useMcoData';
import { formatDate, formatSecurity, formatTimeUntil, securityTier } from '../lib/format';
import { filterByGroup, memberIdSet, type GroupFilter } from '../lib/groups';
import { ALL_TAGS, filterByTag, memberIdSet as tagMemberIdSet, type TagFilter } from '../lib/tags';
import {
  bestRoute,
  cloneJumpOnCooldown,
  cloneLabel,
  formatJumps,
  formatLightYears,
  sortNearest,
  NEAREST_METRIC_LABELS,
  type NearestMetric,
} from '../lib/nearestView';
import GroupSelect from '../components/GroupSelect';
import TagSelect from '../components/TagSelect';
import TargetSystemPicker from '../components/TargetSystemPicker';
import { useCharacterContextMenu } from '../components/useCharacterContextMenu';

/** Close enough to matter on the summary chip: a couple of minutes of gates. */
const NEARBY_JUMPS = 5;

interface SystemGroup {
  key: string;
  systemId: number | null;
  systemName: string | null;
  security: number | null;
  regionName: string | null;
  members: LocationEntry[];
}

function groupBySystem(entries: LocationEntry[]): SystemGroup[] {
  const groups = new Map<string, SystemGroup>();
  for (const entry of entries) {
    const key = entry.systemId === null ? 'unknown' : String(entry.systemId);
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        systemId: entry.systemId,
        systemName: entry.systemName,
        security: entry.security,
        regionName: entry.regionName,
        members: [],
      };
      groups.set(key, group);
    }
    group.members.push(entry);
  }
  return [...groups.values()].sort((a, b) => {
    // Unknown locations sink to the bottom; otherwise busiest systems first.
    if (a.systemId === null) return 1;
    if (b.systemId === null) return -1;
    if (b.members.length !== a.members.length) return b.members.length - a.members.length;
    return (a.systemName ?? '').localeCompare(b.systemName ?? '');
  });
}

/** Search matches system, region, character, ship, account, or docked station/structure. */
function filterBoard<T extends LocationEntry>(entries: T[], search: string): T[] {
  const needle = search.trim().toLowerCase();
  if (!needle) return entries;
  return entries.filter((entry) =>
    [
      entry.characterName,
      entry.systemName ?? '',
      entry.regionName ?? '',
      entry.shipTypeName ?? '',
      entry.accountLabel ?? '',
      entry.dockedName ?? '',
    ]
      .join('\n')
      .toLowerCase()
      .includes(needle),
  );
}

function SystemHeader({ group }: { group: SystemGroup }) {
  if (group.systemId === null) {
    return <h3>Unknown — not synced yet ({group.members.length})</h3>;
  }
  return (
    <h3>
      <span className={`sec-${securityTier(group.security)}`}>
        {formatSecurity(group.security)}
      </span>{' '}
      {group.systemName ?? `System ${group.systemId}`}
      {group.regionName && <span className="muted"> · {group.regionName}</span>}
      <span className="muted"> ({group.members.length})</span>
    </h3>
  );
}

/**
 * The ranking itself: one row per character with a known location, nearest
 * first. Dense on purpose — the answer is usually in the top few rows, but the
 * rows below it are what you fall back to when the nearest one is on the same
 * account as the ship that needs the cyno.
 */
function NearestTable({
  entries,
  metric,
  hasJumpData,
  includesJumpClones,
  selectedTagName,
  loading,
  onRowContextMenu,
}: {
  entries: NearestCharacterEntry[];
  metric: NearestMetric;
  hasJumpData: boolean;
  includesJumpClones: boolean;
  /** The capability being asked about, or null when the tag filter is off. */
  selectedTagName: string | null;
  loading: boolean;
  onRowContextMenu: (event: MouseEvent, characterId: number, characterName: string) => void;
}) {
  const columns = includesJumpClones ? 10 : 9;
  return (
    <>
      {!hasJumpData && (
        <div className="creator-notice" data-testid="nearest-no-jump-data">
          The stargate map has not been imported, so gate distances are unavailable — re-import
          static data from the banner at the top to rank by jumps.
        </div>
      )}
      <table className="data-table" data-testid="nearest-table">
        <thead>
          <tr>
            <th>Character</th>
            <th className="num">Jumps</th>
            <th className="num">Distance</th>
            {includesJumpClones && (
              <th title="A clone jump arrives in a pod — it only helps where a cyno ship is already stationed.">
                Via
              </th>
            )}
            <th>System</th>
            <th>Status</th>
            <th>Ship</th>
            <th>Tags</th>
            <th>Account</th>
            <th>Seen</th>
          </tr>
        </thead>
        <tbody>
          {entries.length === 0 && (
            <tr>
              <td colSpan={columns} className="no-matches">
                {loading ? 'Measuring…' : 'No characters match the current filter.'}
              </td>
            </tr>
          )}
          {entries.map((entry) => {
            const route = bestRoute(entry, metric);
            return (
              <tr
                key={entry.characterId}
                data-testid={`nearest-row-${entry.characterId}`}
                onContextMenu={(e) => onRowContextMenu(e, entry.characterId, entry.characterName)}
              >
                <td>
                  <span className="cell-name">
                    <Link to={`/character/${entry.characterId}`}>{entry.characterName}</Link>
                  </span>
                </td>
                <td
                  className={route.jumps === 0 ? 'num nearest-here' : 'num'}
                  title={
                    route.jumps === null
                      ? 'No gate route — wormhole space'
                      : route.via === 'clone'
                        ? `From where it is now: ${formatJumps(entry.jumps)} jumps`
                        : undefined
                  }
                >
                  {formatJumps(route.jumps)}
                </td>
                <td className="num">{formatLightYears(route.lightYears)}</td>
                {includesJumpClones && (
                  <td data-testid={`nearest-via-${entry.characterId}`}>
                    {route.clone === null ? (
                      <span className="muted">In place</span>
                    ) : (
                      <span className="nearest-via">
                        <span className="chip">JC</span>
                        <span title={route.clone.locationName ?? undefined}>
                          {cloneLabel(route.clone)}
                        </span>
                        <span className="muted">
                          <span className={`sec-${securityTier(route.clone.security)}`}>
                            {formatSecurity(route.clone.security)}
                          </span>{' '}
                          {route.clone.systemName ?? '—'}
                        </span>
                        {cloneJumpOnCooldown(entry.cloneJumpReadyAt) ? (
                          <span className="chip chip--fatigue">
                            {formatTimeUntil(entry.cloneJumpReadyAt).replace(/^in /, '')}
                          </span>
                        ) : (
                          <span className="muted">ready</span>
                        )}
                      </span>
                    )}
                  </td>
                )}
                <td>
                  <span className={`sec-${securityTier(entry.security)}`}>
                    {formatSecurity(entry.security)}
                  </span>{' '}
                  {entry.systemName ?? `System ${entry.systemId}`}
                  {entry.regionName && <span className="muted"> · {entry.regionName}</span>}
                </td>
                <td className="muted">{entry.docked ? (entry.dockedName ?? 'Docked') : 'In space'}</td>
                <td className="muted">{entry.shipTypeName ?? '—'}</td>
                {/* Only the capability being asked about: at 90 characters with
                    several tags each, every other chip is noise in a column
                    that exists to confirm "yes, this one can do the thing".
                    The rest stay one hover away. */}
                <td title={entry.tagNames.length > 0 ? entry.tagNames.join(', ') : undefined}>
                  {selectedTagName !== null && entry.tagNames.includes(selectedTagName) ? (
                    <span className="chip">{selectedTagName}</span>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td className="muted">{entry.accountLabel ?? '—'}</td>
                <td className="muted">{formatDate(entry.updatedAt)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

export default function Location() {
  const [group, setGroup] = useState<GroupFilter>('all');
  const [tagFilter, setTagFilter] = useState<TagFilter>(ALL_TAGS);
  const [search, setSearch] = useState('');
  const [target, setTarget] = useState<SystemSearchResult | null>(null);
  const [metric, setMetric] = useState<NearestMetric>('jumps');
  const [includeClones, setIncludeClones] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importStatus, setImportStatus] = useState<string | null>(null);

  const { data, error, loading, reload, setError } = useMcoData(
    async () => {
      const [board, charGroups, tags] = await Promise.all([
        mco.location.board(),
        mco.groups.list(),
        mco.tags.list(),
      ]);
      return { board, charGroups, tags };
    },
    { onCharactersChanged: true },
  );
  const { board = [], charGroups = [], tags = [] } = data ?? {};

  // The ranking is a read of its own: it depends on a system the user picks,
  // and answering it costs a graph search the plain board has no use for.
  const nearest = useMcoData(
    async () =>
      target === null ? null : await mco.location.nearest(target.solarSystemId, includeClones),
    { deps: [target?.solarSystemId ?? null, includeClones], onCharactersChanged: true },
  );
  const reloadNearest = nearest.reload;

  const { openMenu, menuElement } = useCharacterContextMenu({
    tags,
    groups: charGroups,
    // A tag toggled from a row changes the ranking's Tags column too.
    onChanged: async () => {
      await reload();
      await reloadNearest();
    },
    onError: setError,
  });

  useEffect(
    () =>
      mco.structures.onImportProgress((p) =>
        setImportStatus(`Resolving structures… ${p.done}/${p.total}`),
      ),
    [],
  );

  const importStructures = useCallback(async () => {
    setImporting(true);
    setImportStatus('Fetching public structure list…');
    try {
      const summary = await mco.structures.importPublic();
      setImportStatus(
        summary.resolved === 0 && summary.failed === 0
          ? `Structures up to date (${summary.totalPublic} public)`
          : `Named ${summary.resolved} of ${summary.totalPublic} public structures` +
            (summary.failed > 0 ? ` (${summary.failed} failed)` : ''),
      );
      await reload();
      await reloadNearest();
    } catch (e) {
      setImportStatus(errorMessage(e));
    } finally {
      setImporting(false);
    }
  }, [reload, reloadNearest]);

  // One narrowing for both views: the board and the ranking are the same
  // characters, so the group/tag/search filters must mean the same thing in
  // each — pick "Cyno" and the ranking is a ranking of cyno alts.
  const narrow = useMemo(() => {
    const groupIds = memberIdSet(charGroups, group);
    const tagIds = tagMemberIdSet(tags, tagFilter);
    return <T extends LocationEntry>(entries: T[]): T[] =>
      filterByTag(filterByGroup(filterBoard(entries, search), groupIds), tagIds);
  }, [charGroups, group, tags, tagFilter, search]);

  const visible = useMemo(() => narrow(board), [board, narrow]);
  const groups = useMemo(() => groupBySystem(visible), [visible]);
  const docked = useMemo(() => visible.filter((e) => e.docked).length, [visible]);
  const located = useMemo(() => visible.filter((e) => e.systemId !== null), [visible]);

  const ranked = useMemo(
    () => sortNearest(narrow(nearest.data?.entries ?? []), metric),
    [nearest.data, narrow, metric],
  );
  // Summary chips count what the ranking shows, so they follow the same best
  // route each row is ranked by rather than the character's own position.
  const routes = useMemo(() => ranked.map((entry) => bestRoute(entry, metric)), [ranked, metric]);
  const inSystem = useMemo(() => routes.filter((r) => r.jumps === 0).length, [routes]);
  const nearby = useMemo(
    () => routes.filter((r) => r.jumps !== null && r.jumps <= NEARBY_JUMPS).length,
    [routes],
  );
  const viaClone = useMemo(() => routes.filter((r) => r.via === 'clone').length, [routes]);
  const selectedTagName = useMemo(
    () => (tagFilter === ALL_TAGS ? null : (tags.find((t) => t.id === tagFilter)?.name ?? null)),
    [tags, tagFilter],
  );

  return (
    <section className="page">
      <div className="toolbar">
        <h2>Location</h2>
        <button
          type="button"
          className="ghost"
          onClick={() => void Promise.all([reload(), reloadNearest()])}
          disabled={loading}
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>
        <button
          type="button"
          className="ghost"
          onClick={() => void importStructures()}
          disabled={importing}
          title="Fetch every public citadel's name from ESI so docked locations resolve"
          data-testid="structures-import"
        >
          {importing ? 'Importing…' : 'Import structures'}
        </button>
        {importStatus && <span className="muted">{importStatus}</span>}
      </div>

      {board.length > 0 && (
        <>
          <div className="stats-strip">
            {target === null ? (
              <>
                <span className="stat-chip">
                  <strong>{groups.filter((g) => g.systemId !== null).length}</strong> systems
                </span>
                <span className="stat-chip">
                  <strong>{docked}</strong> docked
                </span>
                <span className="stat-chip">
                  <strong>{located.length - docked}</strong> in space
                </span>
              </>
            ) : (
              <>
                <span className="stat-chip">
                  <strong>{inSystem}</strong> in system
                </span>
                <span className="stat-chip">
                  <strong>{nearby}</strong> within {NEARBY_JUMPS} jumps
                </span>
                {nearest.data?.includesJumpClones === true && (
                  <span className="stat-chip" title="Characters whose nearest jump clone beats flying">
                    <strong>{viaClone}</strong> via jump clone
                  </span>
                )}
                {(nearest.data?.unmeasuredClones ?? 0) > 0 && (
                  <span
                    className="stat-chip"
                    title="Clones in a citadel MCO has not resolved to a system — run Import structures"
                  >
                    <strong>{nearest.data?.unmeasuredClones}</strong> clones unresolved
                  </span>
                )}
                {(nearest.data?.unlocatedCount ?? 0) > 0 && (
                  <span className="stat-chip">
                    <strong>{nearest.data?.unlocatedCount}</strong> never synced
                  </span>
                )}
              </>
            )}
          </div>

          <div className="filter-bar">
            <input
              type="search"
              placeholder="Search system, region, character, ship…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              data-testid="location-search"
            />
            <GroupSelect
              groups={charGroups}
              value={group}
              onChange={setGroup}
              testId="location-group-filter"
            />
            <TagSelect
              tags={tags}
              value={tagFilter}
              onChange={setTagFilter}
              testId="location-tag-filter"
            />
            <TargetSystemPicker current={target} onSelect={setTarget} />
            {target !== null && (
              <>
                <select
                  value={metric}
                  onChange={(e) => setMetric(e.target.value as NearestMetric)}
                  aria-label="Rank by distance"
                  data-testid="nearest-metric"
                >
                  {(Object.keys(NEAREST_METRIC_LABELS) as NearestMetric[]).map((key) => (
                    <option key={key} value={key}>
                      {NEAREST_METRIC_LABELS[key]}
                    </option>
                  ))}
                </select>
                <label
                  className="muted"
                  title="Also measure each character's jump clones. A clone jump arrives in a pod, so it only helps where a cyno ship is already stationed."
                >
                  <input
                    type="checkbox"
                    checked={includeClones}
                    onChange={(e) => setIncludeClones(e.target.checked)}
                    data-testid="nearest-include-clones"
                  />{' '}
                  Jump clones
                </label>
              </>
            )}
            <span className="filter-bar__count">
              {target !== null
                ? `${ranked.length} ranked`
                : visible.length !== board.length
                  ? `${visible.length} of ${board.length}`
                  : `${board.length} characters`}
            </span>
          </div>
        </>
      )}

      {error && (
        <div className="error-box" data-testid="location-error">
          {error}
        </div>
      )}
      {nearest.error && (
        <div className="error-box" data-testid="nearest-error">
          {nearest.error}
        </div>
      )}

      {board.length === 0 ? (
        <div className="empty-state">
          <h3>No characters yet</h3>
          <p>Add characters and sync them to see where they are.</p>
        </div>
      ) : target !== null ? (
        <NearestTable
          entries={ranked}
          metric={metric}
          hasJumpData={nearest.data?.hasJumpData ?? true}
          includesJumpClones={nearest.data?.includesJumpClones ?? false}
          selectedTagName={selectedTagName}
          loading={nearest.loading}
          onRowContextMenu={openMenu}
        />
      ) : visible.length === 0 ? (
        <div className="no-matches">No characters match the current filter.</div>
      ) : (
        <div className="detail-grid" data-testid="location-board">
          {groups.map((group) => (
            <div className="card" key={group.key}>
              <SystemHeader group={group} />
              <ul className="result-list">
                {group.members.map((member) => (
                  <li
                    key={member.characterId}
                    onContextMenu={(e) => openMenu(e, member.characterId, member.characterName)}
                  >
                    <span className="result-row">
                      <Link to={`/character/${member.characterId}`}>{member.characterName}</Link>
                      <span className="muted">{member.docked ? 'Docked' : 'In space'}</span>
                    </span>
                    <div className="muted location-sub">
                      {member.dockedName ? `${member.dockedName} · ` : ''}
                      {member.shipTypeName ??
                        (member.systemId === null ? 'never synced' : 'unknown ship')}
                      {member.accountLabel ? ` · ${member.accountLabel}` : ''}
                      {member.updatedAt ? ` · ${formatDate(member.updatedAt)}` : ''}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {menuElement}
    </section>
  );
}
