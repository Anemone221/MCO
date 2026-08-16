import { useNavigate } from 'react-router-dom';
import type { DashboardSummary, IncomeSummary } from '@shared/types';
import { mco } from '../lib/ipc';
import { formatIsk, formatIskShort, formatSp } from '../lib/format';
import { useCountUp } from '../lib/useCountUp';
import { useMcoData } from '../lib/useMcoData';
import CharacterSpChart from '../components/charts/CharacterSpChart';
import StatTile from '../components/StatTile';

/** Tranquility's own state and MCO's standing with ESI, one line each. */
function esiStatusHint(summary: DashboardSummary): string {
  const server = summary.serverStatus.online
    ? `${summary.serverStatus.players?.toLocaleString() ?? '—'} pilots online${
        summary.serverStatus.vip ? ' · VIP mode' : ''
      }`
    : 'Server status unavailable';
  const health = summary.esiHealth.healthy
    ? 'MCO ↔ ESI: healthy'
    : `MCO ↔ ESI: rate-limited, retrying in ${summary.esiHealth.backoffSeconds}s`;
  return `${server}\n${health}`;
}

/** What the month's income is made of, unlabelled figures under a labelled total. */
function incomeHint(income: IncomeSummary): string {
  return `This month · ${formatIskShort(income.bountyIsk)} bounty · ${formatIskShort(
    income.missionIsk,
  )} missions · ${formatIskShort(income.corpRewardIsk)} rewards`;
}

export default function Dashboard() {
  const navigate = useNavigate();
  const {
    data: summary,
    error,
    loading,
    reload,
  } = useMcoData(() => mco.dashboard.summary(), { onCharactersChanged: true });

  // Headline numbers glide between readings (hooks stay unconditional).
  const onlineCount = useCountUp(summary?.online.onlineCount ?? 0);
  const registeredCount = useCountUp(summary?.charactersRegistered ?? 0);
  const totalSp = useCountUp(summary?.totalSp ?? 0);
  const incomeTotal = useCountUp(summary?.income.totalIsk ?? 0);

  return (
    <section className="page">
      <div className="toolbar">
        <h2>Dashboard</h2>
        <button type="button" className="ghost" onClick={() => void reload()} disabled={loading}>
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
            <StatTile
              index={0}
              label="ESI Status"
              testId="tile-esi-status"
              hint={esiStatusHint(summary)}
            >
              <div className="dashboard-tile__value">
                {summary.serverStatus.online ? 'Tranquility online' : 'Tranquility offline'}
              </div>
            </StatTile>

            <StatTile
              index={1}
              label="Characters online"
              testId="tile-characters-online"
              hint={
                summary.online.missingScopeCount > 0
                  ? `${summary.online.missingScopeCount} need re-adding to grant the online-status scope`
                  : undefined
              }
            >
              <div className="dashboard-tile__value">
                {Math.round(onlineCount)} / {summary.online.totalCharacters}
              </div>
            </StatTile>

            <StatTile index={2} label="Characters registered" testId="tile-characters-registered">
              <div className="dashboard-tile__value">{Math.round(registeredCount)}</div>
            </StatTile>

            <StatTile index={3} label="Total SP" testId="tile-total-sp">
              <div className="dashboard-tile__value">{formatSp(Math.round(totalSp))}</div>
            </StatTile>

            <StatTile
              index={4}
              label="Income"
              testId="tile-income"
              hint={incomeHint(summary.income)}
            >
              <div className="dashboard-tile__value">{formatIsk(incomeTotal)}</div>
            </StatTile>
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
