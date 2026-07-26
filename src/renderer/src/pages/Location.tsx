import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { CharacterGroup, LocationEntry } from '@shared/types';
import { mco } from '../lib/ipc';
import { formatDate, formatSecurity, securityTier } from '../lib/format';
import { filterByGroup, memberIdSet, type GroupFilter } from '../lib/groups';
import GroupSelect from '../components/GroupSelect';

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
function filterBoard(entries: LocationEntry[], search: string): LocationEntry[] {
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

export default function Location() {
  const [board, setBoard] = useState<LocationEntry[]>([]);
  const [charGroups, setCharGroups] = useState<CharacterGroup[]>([]);
  const [group, setGroup] = useState<GroupFilter>('all');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [importing, setImporting] = useState(false);
  const [importStatus, setImportStatus] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [b, g] = await Promise.all([mco.location.board(), mco.groups.list()]);
      setBoard(b);
      setCharGroups(g);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    return mco.characters.onChanged(() => void load());
  }, [load]);

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
      await load();
    } catch (e) {
      setImportStatus(String(e));
    } finally {
      setImporting(false);
    }
  }, [load]);

  const visible = useMemo(() => {
    const ids = memberIdSet(charGroups, group);
    return filterByGroup(filterBoard(board, search), ids);
  }, [board, search, charGroups, group]);
  const groups = useMemo(() => groupBySystem(visible), [visible]);
  const docked = useMemo(() => visible.filter((e) => e.docked).length, [visible]);
  const located = useMemo(() => visible.filter((e) => e.systemId !== null), [visible]);

  return (
    <section className="page">
      <div className="toolbar">
        <h2>Location</h2>
        <button type="button" className="ghost" onClick={() => void load()} disabled={loading}>
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
            <span className="stat-chip">
              <strong>{groups.filter((g) => g.systemId !== null).length}</strong> systems
            </span>
            <span className="stat-chip">
              <strong>{docked}</strong> docked
            </span>
            <span className="stat-chip">
              <strong>{located.length - docked}</strong> in space
            </span>
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
            <span className="filter-bar__count">
              {visible.length !== board.length
                ? `${visible.length} of ${board.length}`
                : `${board.length} characters`}
            </span>
          </div>
        </>
      )}

      {error && <div className="error-box" data-testid="location-error">{error}</div>}

      {board.length === 0 ? (
        <div className="empty-state">
          <h3>No characters yet</h3>
          <p>Add characters and sync them to see where they are.</p>
        </div>
      ) : visible.length === 0 ? (
        <div className="no-matches">No characters match the current filter.</div>
      ) : (
        <div className="detail-grid" data-testid="location-board">
          {groups.map((group) => (
            <div className="card" key={group.key}>
              <SystemHeader group={group} />
              <ul className="result-list">
                {group.members.map((member) => (
                  <li key={member.characterId}>
                    <span className="result-row">
                      <Link to={`/character/${member.characterId}`}>
                        {member.characterName}
                      </Link>
                      <span className="muted">
                        {member.docked ? 'Docked' : 'In space'}
                      </span>
                    </span>
                    <div className="muted location-sub">
                      {member.dockedName ? `${member.dockedName} · ` : ''}
                      {member.shipTypeName ?? (member.systemId === null ? 'never synced' : 'unknown ship')}
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
    </section>
  );
}
