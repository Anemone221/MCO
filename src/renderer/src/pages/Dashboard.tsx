import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import type { DashboardSummary } from '@shared/types';
import { mco } from '../lib/ipc';
import { formatIsk, formatSp } from '../lib/format';
import { useCountUp } from '../lib/useCountUp';
import CharacterSpChart from '../components/charts/CharacterSpChart';

/** Stat tile with the shared entrance stagger (index drives the delay). */
function Tile({
  index,
  label,
  testId,
  children,
}: {
  index: number;
  label: string;
  testId: string;
  children: ReactNode;
}) {
  return (
    <div
      className="dashboard-tile"
      style={{ '--tile-index': index } as CSSProperties}
      data-testid={testId}
    >
      <div className="dashboard-tile__label">{label}</div>
      {children}
    </div>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSummary(await mco.dashboard.summary());
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

  // Headline numbers glide between readings (hooks stay unconditional).
  const onlineCount = useCountUp(summary?.online.onlineCount ?? 0);
  const registeredCount = useCountUp(summary?.charactersRegistered ?? 0);
  const totalSp = useCountUp(summary?.totalSp ?? 0);
  const rattedTotal = useCountUp(summary?.rattedIsk.totalIsk ?? 0);

  return (
    <section className="page">
      <div className="toolbar">
        <h2>Dashboard</h2>
        <button type="button" className="ghost" onClick={() => void load()} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div className="error-box" data-testid="dashboard-error">
          {error}
        </div>
      )}

      {summary && (
        <>
          <div className="dashboard-tiles" data-testid="dashboard-tiles">
            <Tile index={0} label="ESI Status" testId="tile-esi-status">
              <div className="dashboard-tile__value">
                {summary.serverStatus.online ? 'Tranquility online' : 'Tranquility offline'}
              </div>
              <div className="dashboard-tile__sub">
                {summary.serverStatus.online
                  ? `${summary.serverStatus.players?.toLocaleString() ?? '—'} pilots online${
                      summary.serverStatus.vip ? ' · VIP mode' : ''
                    }`
                  : 'Server status unavailable'}
              </div>
              <div className="dashboard-tile__sub">
                {summary.esiHealth.healthy
                  ? 'MCO ↔ ESI: healthy'
                  : `MCO ↔ ESI: rate-limited, retrying in ${summary.esiHealth.backoffSeconds}s`}
              </div>
            </Tile>

            <Tile index={1} label="Characters online" testId="tile-characters-online">
              <div className="dashboard-tile__value">
                {Math.round(onlineCount)} / {summary.online.totalCharacters}
              </div>
              {summary.online.missingScopeCount > 0 && (
                <div className="dashboard-tile__sub muted">
                  {summary.online.missingScopeCount} need re-adding to grant the online-status scope
                </div>
              )}
            </Tile>

            <Tile index={2} label="Characters registered" testId="tile-characters-registered">
              <div className="dashboard-tile__value">{Math.round(registeredCount)}</div>
            </Tile>

            <Tile index={3} label="Total SP" testId="tile-total-sp">
              <div className="dashboard-tile__value">{formatSp(Math.round(totalSp))}</div>
            </Tile>

            <Tile index={4} label="Ratted ISK this month" testId="tile-ratted-isk">
              <div className="dashboard-tile__value">{formatIsk(rattedTotal)}</div>
              <div className="dashboard-tile__sub muted">
                {formatIsk(summary.rattedIsk.bountyIsk)} bounty · {formatIsk(summary.rattedIsk.missionIsk)} missions
              </div>
            </Tile>
          </div>

          {summary.characters.length === 0 ? (
            <div className="empty-state">
              <h3>No characters yet</h3>
              <p>Add characters and sync them to see them sized by skill points here.</p>
            </div>
          ) : (
            <div className="card sp-chart-card" data-testid="sp-chart">
              <h3>Characters by total SP</h3>
              <CharacterSpChart
                characters={summary.characters}
                onSelect={(characterId) => navigate(`/character/${characterId}`)}
              />
            </div>
          )}
        </>
      )}
    </section>
  );
}
