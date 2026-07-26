import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { CloneBoardEntry, EsiDataStatus, ImplantInfo, JumpCloneEntry } from '@shared/types';
import { mco } from '../lib/ipc';
import { formatDate, formatTimeUntil } from '../lib/format';
import CharacterAvatar from '../components/CharacterAvatar';

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

function ImplantList({ implants }: { implants: ImplantInfo[] }) {
  if (implants.length === 0) return <p className="muted">No implants.</p>;
  return (
    <ul className="result-list">
      {implants.map((implant) => (
        <li key={implant.typeId}>{implant.typeName ?? `Implant ${implant.typeId}`}</li>
      ))}
    </ul>
  );
}

function cloneLocation(
  clone: Pick<JumpCloneEntry, 'locationId' | 'locationType' | 'locationName'>,
): string {
  if (clone.locationName) return clone.locationName;
  if (clone.locationType === 'structure' && clone.locationId !== null) {
    return `Structure ${clone.locationId}`;
  }
  if (clone.locationId !== null) return `Location ${clone.locationId}`;
  return 'Unknown location';
}

function CloneRow({
  entry,
  expanded,
  onToggle,
}: {
  entry: CloneBoardEntry;
  expanded: boolean;
  onToggle: () => void;
}) {
  const label = statusLabel(entry.status, entry.missingScopes);
  // Implants can sync on tokens that predate the clones scope, so show
  // whatever synced — but only claim "no jump clones" when we could ask.
  const hasSyncedData = entry.updatedAt !== null;
  const jcCooldown =
    entry.nextCloneJumpAt !== null && new Date(entry.nextCloneJumpAt).getTime() > Date.now();

  return (
    <div className="row-list__row" data-testid={`clone-card-${entry.characterId}`}>
      <div
        className="row-list__header"
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggle();
          }
        }}
      >
        <span className="row-list__chevron">{expanded ? '▼' : '▶'}</span>
        <CharacterAvatar characterId={entry.characterId} />
        <span className="row-list__title">
          <Link to={`/character/${entry.characterId}`} onClick={(e) => e.stopPropagation()}>
            {entry.characterName}
          </Link>
          {entry.accountLabel && <span className="muted"> · {entry.accountLabel}</span>}
        </span>
        {label && (
          <span className={`status-pill status-pill--${entry.status}`} data-testid="clone-status">
            {label}
          </span>
        )}
        <span className="row-list__meta">
          {hasSyncedData && (
            <>
              {jcCooldown ? (
                <span className="chip chip--fatigue" data-testid={`jc-cooldown-${entry.characterId}`}>
                  JC {formatTimeUntil(entry.nextCloneJumpAt).replace(/^in /, '')}
                </span>
              ) : (
                <span>JC ready</span>
              )}
              <span>{entry.activeImplants.length} implants</span>
              <span>{entry.clones.length} jump clones</span>
              <span>{formatDate(entry.updatedAt)}</span>
            </>
          )}
        </span>
      </div>

      {expanded && hasSyncedData && (
        <div className="row-list__body">
          <h4>Active clone</h4>
          <ImplantList implants={entry.activeImplants} />

          {entry.status === 'ok' && (
            <>
              <h4>Medical clone</h4>
              <p className="muted" data-testid={`med-clone-${entry.characterId}`}>
                {entry.medicalClone ? cloneLocation(entry.medicalClone) : '—'}
              </p>
              {entry.clones.map((clone) => (
                <div key={clone.jumpCloneId} className="clone-block">
                  <h4>
                    {clone.name ?? 'Jump clone'}
                    <span className="muted"> · {cloneLocation(clone)}</span>
                  </h4>
                  <ImplantList implants={clone.implants} />
                </div>
              ))}
              {entry.clones.length === 0 && <p className="muted">No jump clones.</p>}
            </>
          )}
        </div>
      )}
      {expanded && !hasSyncedData && (
        <div className="row-list__body">
          <p className="muted">Nothing synced for this character yet.</p>
        </div>
      )}
    </div>
  );
}

export default function Clones() {
  const [board, setBoard] = useState<CloneBoardEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [attentionOnly, setAttentionOnly] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setBoard(await mco.clones.board());
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

  const needsAttention = useMemo(
    () => board.filter((e) => e.status === 'scope-missing' || e.status === 'login-expired').length,
    [board],
  );

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return board.filter((entry) => {
      if (attentionOnly && entry.status !== 'scope-missing' && entry.status !== 'login-expired') {
        return false;
      }
      if (!needle) return true;
      const implantNames = [
        ...entry.activeImplants,
        ...entry.clones.flatMap((c) => c.implants),
      ].map((i) => i.typeName ?? '');
      const haystack = [entry.characterName, entry.accountLabel ?? '', ...implantNames]
        .join('\n')
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [board, search, attentionOnly]);

  function toggle(characterId: number): void {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(characterId)) next.delete(characterId);
      else next.add(characterId);
      return next;
    });
  }

  const allVisibleExpanded = visible.length > 0 && visible.every((e) => expanded.has(e.characterId));

  return (
    <section className="page">
      <div className="toolbar">
        <h2>Clones</h2>
        <button type="button" className="ghost" onClick={() => void load()} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {board.length > 0 && (
        <div className="filter-bar">
          <input
            type="search"
            placeholder="Search character, account, or implant…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="clones-search"
          />
          <label className="muted">
            <input
              type="checkbox"
              checked={attentionOnly}
              onChange={(e) => setAttentionOnly(e.target.checked)}
            />{' '}
            Needs attention ({needsAttention})
          </label>
          <button
            type="button"
            className="ghost btn-sm"
            onClick={() =>
              setExpanded(
                allVisibleExpanded ? new Set() : new Set(visible.map((e) => e.characterId)),
              )
            }
          >
            {allVisibleExpanded ? 'Collapse all' : 'Expand all'}
          </button>
          <span className="filter-bar__count">
            {visible.length !== board.length
              ? `${visible.length} of ${board.length}`
              : `${board.length} characters`}
          </span>
        </div>
      )}

      {error && <div className="error-box" data-testid="clones-error">{error}</div>}

      {board.length === 0 ? (
        <div className="empty-state">
          <h3>No characters yet</h3>
          <p>Add characters and sync them to see their clones and implants.</p>
        </div>
      ) : (
        <div className="row-list" data-testid="clones-board">
          {visible.length === 0 && (
            <div className="no-matches">No characters match the current filters.</div>
          )}
          {visible.map((entry) => (
            <CloneRow
              key={entry.characterId}
              entry={entry}
              expanded={expanded.has(entry.characterId)}
              onToggle={() => toggle(entry.characterId)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
