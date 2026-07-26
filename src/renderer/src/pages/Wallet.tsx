import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import type { WalletSummary } from '@shared/types';
import { mco } from '../lib/ipc';
import { formatIsk } from '../lib/format';
import IncomeByDayChart from '../components/charts/IncomeByDayChart';

export default function Wallet() {
  const [summary, setSummary] = useState<WalletSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSummary(await mco.wallet.summary());
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

  const hasIncome =
    summary !== null && summary.rattedIskByDay.some((d) => d.bountyIsk + d.missionIsk > 0);

  return (
    <section className="page">
      <div className="toolbar">
        <h2>Wallet</h2>
        <button type="button" className="ghost" onClick={() => void load()} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div className="error-box" data-testid="wallet-error">
          {error}
        </div>
      )}

      {summary && (
        <>
          <div className="dashboard-tiles" data-testid="wallet-tiles">
            <div className="dashboard-tile" style={{ '--tile-index': 0 } as CSSProperties}>
              <div className="dashboard-tile__label">Ratted ISK this month</div>
              <div className="dashboard-tile__value">{formatIsk(summary.rattedIsk.totalIsk)}</div>
            </div>
            <div className="dashboard-tile" style={{ '--tile-index': 1 } as CSSProperties}>
              <div className="dashboard-tile__label">Bounties</div>
              <div className="dashboard-tile__value">{formatIsk(summary.rattedIsk.bountyIsk)}</div>
              <div className="dashboard-tile__sub muted">NPC bounties + ESS payouts</div>
            </div>
            <div className="dashboard-tile" style={{ '--tile-index': 2 } as CSSProperties}>
              <div className="dashboard-tile__label">Missions</div>
              <div className="dashboard-tile__value">{formatIsk(summary.rattedIsk.missionIsk)}</div>
              <div className="dashboard-tile__sub muted">Agent mission rewards</div>
            </div>
          </div>

          <div className="card chart-card" data-testid="income-chart">
            <h3>Ratted ISK by day</h3>
            {hasIncome ? (
              <IncomeByDayChart series={summary.rattedIskByDay} />
            ) : (
              <p className="muted" data-testid="income-chart-empty">
                No ratted income recorded this month.
              </p>
            )}
          </div>
        </>
      )}
    </section>
  );
}
