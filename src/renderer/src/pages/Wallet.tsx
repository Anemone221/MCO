import { useState } from 'react';
import { mco } from '../lib/ipc';
import { formatIsk, formatIskShort, formatMonthLabel } from '../lib/format';
import { useMcoData } from '../lib/useMcoData';
import IncomeByDayChart from '../components/charts/IncomeByDayChart';
import WalletHistoryChart from '../components/charts/WalletHistoryChart';
import StatTile from '../components/StatTile';
import { ChevronIcon } from '../components/icons';

const HISTORY_COLLAPSED_KEY = 'mco-wallet-history-collapsed';

/** Previous months start collapsed: this month is the page, history is the aside. */
function loadHistoryCollapsed(): boolean {
  try {
    return localStorage.getItem(HISTORY_COLLAPSED_KEY) !== '0';
  } catch {
    return true;
  }
}

function storeHistoryCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(HISTORY_COLLAPSED_KEY, collapsed ? '1' : '0');
  } catch {
    // A profile with storage blocked just loses the preference.
  }
}

export default function Wallet() {
  const {
    data: summary,
    error,
    loading,
    reload,
  } = useMcoData(() => mco.wallet.summary(), { onCharactersChanged: true });
  const [historyCollapsed, setHistoryCollapsed] = useState(loadHistoryCollapsed);

  function toggleHistory(): void {
    setHistoryCollapsed((prev) => {
      storeHistoryCollapsed(!prev);
      return !prev;
    });
  }

  const hasIncome = summary !== null && summary.byDay.some((d) => d.income.totalIsk > 0);
  const months = summary?.previousMonths ?? [];

  return (
    <section className="page">
      <div className="toolbar">
        <h2>Wallet</h2>
        <button type="button" className="ghost" onClick={() => void reload()} disabled={loading}>
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
            <StatTile
              index={0}
              label="Income"
              testId="tile-income"
              hint="This month · bounties + missions + reward payouts"
            >
              <div className="dashboard-tile__value">
                {formatIsk(summary.totals.income.totalIsk)}
              </div>
            </StatTile>
            <StatTile
              index={1}
              label="Bounties"
              testId="tile-bounties"
              hint="NPC bounties + ESS payouts"
            >
              <div className="dashboard-tile__value">
                {formatIsk(summary.totals.income.bountyIsk)}
              </div>
            </StatTile>
            <StatTile
              index={2}
              label="Missions"
              testId="tile-missions"
              hint="Agent mission rewards"
            >
              <div className="dashboard-tile__value">
                {formatIsk(summary.totals.income.missionIsk)}
              </div>
            </StatTile>
            <StatTile
              index={3}
              label="Corporate reward payout"
              testId="tile-corp-reward"
              hint={'CONCORD site rewards, net of corp tax\n(ESI reports the payout already taxed)'}
            >
              <div className="dashboard-tile__value">
                {formatIsk(summary.totals.income.corpRewardIsk)}
              </div>
            </StatTile>
            <StatTile
              index={4}
              label="Tax paid"
              testId="tile-tax"
              hint={
                'Sales, industry and corp tax, incl. tax withheld at source\n' +
                'ESI omits corp tax on CONCORD rewards, so that share is missing'
              }
            >
              <div className="dashboard-tile__value">{formatIsk(summary.totals.taxIsk)}</div>
            </StatTile>
            <StatTile
              index={5}
              label="Expenses"
              testId="tile-expenses"
              hint={'Fees, skill purchases, gate tolls, repairs, PI\nNot market escrow or contracts'}
            >
              <div className="dashboard-tile__value">{formatIsk(summary.totals.expenseIsk)}</div>
            </StatTile>
            <StatTile
              index={6}
              label="Player donations"
              testId="tile-donations"
              hint={
                summary.totals.internalTransferIsk > 0
                  ? `${formatIsk(summary.totals.donationsInIsk)} received · ${formatIsk(
                      summary.totals.donationsOutIsk,
                    )} sent\n${formatIsk(
                      summary.totals.internalTransferIsk,
                    )} moved between your own characters (counted in neither)`
                  : `${formatIsk(summary.totals.donationsInIsk)} received · ${formatIsk(
                      summary.totals.donationsOutIsk,
                    )} sent`
              }
            >
              <div className="dashboard-tile__value">
                {formatIskShort(summary.totals.donationsInIsk)} in ·{' '}
                {formatIskShort(summary.totals.donationsOutIsk)} out
              </div>
            </StatTile>
          </div>

          <div className="card chart-card" data-testid="income-chart">
            <h3>Income by day</h3>
            {hasIncome ? (
              <IncomeByDayChart series={summary.byDay} />
            ) : (
              <p className="muted" data-testid="income-chart-empty">
                No income recorded this month.
              </p>
            )}
          </div>

          <div className="settings-section" data-testid="wallet-history">
            <div className="settings-section__header">
              <button
                type="button"
                className="collapse-toggle"
                aria-expanded={!historyCollapsed}
                title={historyCollapsed ? 'Expand' : 'Collapse'}
                onClick={toggleHistory}
                data-testid="wallet-history-toggle"
              >
                <ChevronIcon open={!historyCollapsed} size={14} />
              </button>
              <h3>Previous months</h3>
              <span className="muted">
                {months.length === 0
                  ? 'nothing recorded yet'
                  : `${months.length} month${months.length === 1 ? '' : 's'} recorded`}
              </span>
            </div>

            {!historyCollapsed && (
              <div className="settings-section__body">
                {months.length === 0 ? (
                  <p className="muted" data-testid="wallet-history-empty">
                    No completed months yet. ESI's journal only reaches about 30 days back, so
                    history builds up from the first sync onward — this fills in as MCO keeps
                    running.
                  </p>
                ) : (
                  <>
                    <WalletHistoryChart months={months} />
                    <table
                      className="data-table wallet-history-table"
                      data-testid="wallet-history-table"
                    >
                      <thead>
                        <tr>
                          <th>Month</th>
                          <th className="num">Income</th>
                          <th className="num">Bounties</th>
                          <th className="num">Missions</th>
                          <th className="num">Rewards</th>
                          <th className="num">Tax paid</th>
                          <th className="num">Expenses</th>
                          <th className="num">Donations in</th>
                          <th className="num">Donations out</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...months].reverse().map((month) => (
                          <tr key={month.month}>
                            <td>{formatMonthLabel(month.month)}</td>
                            <td className="num">{formatIsk(month.income.totalIsk)}</td>
                            <td className="num">{formatIsk(month.income.bountyIsk)}</td>
                            <td className="num">{formatIsk(month.income.missionIsk)}</td>
                            <td className="num">{formatIsk(month.income.corpRewardIsk)}</td>
                            <td className="num">{formatIsk(month.taxIsk)}</td>
                            <td className="num">{formatIsk(month.expenseIsk)}</td>
                            <td className="num">{formatIsk(month.donationsInIsk)}</td>
                            <td className="num">{formatIsk(month.donationsOutIsk)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
