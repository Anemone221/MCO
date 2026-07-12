import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { CharacterDetail as Detail } from '@shared/types';
import { mco } from '../lib/ipc';
import { formatDate, formatSp, formatTimeUntil, romanLevel } from '../lib/format';

export default function CharacterDetail() {
  const params = useParams<{ id: string }>();
  const characterId = Number(params.id);

  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setDetail(await mco.characters.detail(characterId));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [characterId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="page">
      <div className="toolbar">
        <h2>
          <Link to="/" className="back-link">
            ← Roster
          </Link>
          {detail ? ` · ${detail.character.name}` : ''}
        </h2>
        <button type="button" onClick={() => void load()} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {error && <div className="error-box" data-testid="detail-error">{error}</div>}

      {detail && (
        <div className="detail-grid">
          <div className="card">
            <h3>Overview</h3>
            <dl>
              <dt>Total SP</dt>
              <dd>{formatSp(detail.totalSp)}</dd>
              <dt>Location</dt>
              <dd>
                {detail.location
                  ? (detail.location.solarSystemName ?? `System ${detail.location.solarSystemId}`)
                  : '—'}
              </dd>
              <dt>Active ship</dt>
              <dd>
                {detail.ship
                  ? `${detail.ship.typeName ?? `Type ${detail.ship.typeId}`} — ${detail.ship.name}`
                  : '—'}
              </dd>
              <dt>Last sync</dt>
              <dd>{formatDate(detail.character.refreshedAt)}</dd>
            </dl>
          </div>

          <div className="card">
            <h3>Skill queue ({detail.skillQueue.length})</h3>
            {detail.skillQueue.length === 0 ? (
              <p className="muted">Queue is empty.</p>
            ) : (
              <ol className="queue-list">
                {detail.skillQueue.map((q) => (
                  <li key={q.position}>
                    <span>
                      {q.skillName ?? `Type ${q.skillTypeId}`} {romanLevel(q.finishLevel)}
                    </span>
                    <span className="muted">{formatTimeUntil(q.finishDate)}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>

          <div className="card">
            <h3>Implants ({detail.implants.length})</h3>
            {detail.implants.length === 0 ? (
              <p className="muted">No implants reported.</p>
            ) : (
              <ul className="implant-list">
                {detail.implants.map((i) => (
                  <li key={i.typeId}>{i.typeName ?? `Type ${i.typeId}`}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
