import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { LocationEntry } from '@shared/types';
import { mco } from '../lib/ipc';
import { formatDate, formatSecurity, securityTier } from '../lib/format';

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
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setBoard(await mco.location.board());
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

  const groups = useMemo(() => groupBySystem(board), [board]);

  return (
    <section className="page">
      <div className="toolbar">
        <h2>Location ({board.length})</h2>
        <button type="button" onClick={() => void load()} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {error && <div className="error-box" data-testid="location-error">{error}</div>}

      {board.length === 0 ? (
        <div className="empty-state">
          <h3>No characters yet</h3>
          <p>Add characters and sync them to see where they are.</p>
        </div>
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
