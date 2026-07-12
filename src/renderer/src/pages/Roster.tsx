import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { AccountBucket, RosterEntry } from '@shared/types';
import { mco } from '../lib/ipc';
import { formatDate, formatSp, formatTimeUntil, romanLevel } from '../lib/format';

function TrainingCell({ entry }: { entry: RosterEntry }) {
  const { training } = entry;
  if (!training.isTraining) {
    return <span className="muted">Not training</span>;
  }
  const skill = training.currentSkillName ?? `Type ${training.currentSkillTypeId}`;
  return (
    <span>
      {skill} {romanLevel(training.currentFinishLevel ?? 0)}{' '}
      <span className="muted">{formatTimeUntil(training.finishDate)}</span>
    </span>
  );
}

export default function Roster() {
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [accounts, setAccounts] = useState<AccountBucket[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [r, a] = await Promise.all([mco.characters.roster(), mco.accounts.list()]);
    setRoster(r);
    setAccounts(a);
  }, []);

  useEffect(() => {
    void load().catch((e: unknown) => setError(String(e)));
    // Refresh the roster when a background sync sweep updates character data.
    return mco.characters.onChanged(() => {
      void load().catch((e: unknown) => setError(String(e)));
    });
  }, [load]);

  async function run(key: string, action: () => Promise<unknown>): Promise<void> {
    setBusy(key);
    setError(null);
    try {
      await action();
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="page">
      <div className="toolbar">
        <h2>Roster ({roster.length})</h2>
        <div className="toolbar__actions">
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void run('add', () => mco.characters.add())}
            data-testid="add-character"
          >
            {busy === 'add' ? 'Waiting for EVE SSO…' : 'Add character'}
          </button>
          <button
            type="button"
            disabled={busy !== null || roster.length === 0}
            onClick={() => void run('syncAll', () => mco.characters.syncAll())}
            data-testid="sync-all"
          >
            {busy === 'syncAll' ? 'Syncing…' : 'Sync all'}
          </button>
        </div>
      </div>

      {error && <div className="error-box" data-testid="roster-error">{error}</div>}

      {roster.length === 0 ? (
        <div className="empty-state">
          <h3>No characters yet</h3>
          <p>Click “Add character” to sign in with EVE SSO.</p>
        </div>
      ) : (
        <table className="data-table" data-testid="roster-table">
          <thead>
            <tr>
              <th>Character</th>
              <th>Account</th>
              <th>Training</th>
              <th>Total SP</th>
              <th>Last sync</th>
              <th aria-label="actions" />
            </tr>
          </thead>
          <tbody>
            {roster.map((entry) => (
              <tr key={entry.character.id} data-testid={`roster-row-${entry.character.id}`}>
                <td>
                  <Link to={`/character/${entry.character.id}`}>{entry.character.name}</Link>
                </td>
                <td>
                  <select
                    value={entry.character.accountId ?? ''}
                    onChange={(e) =>
                      void run('account', () =>
                        mco.characters.assignAccount(
                          entry.character.id,
                          e.target.value === '' ? null : Number(e.target.value),
                        ),
                      )
                    }
                    data-testid={`account-select-${entry.character.id}`}
                  >
                    <option value="">Unassigned</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <TrainingCell entry={entry} />
                </td>
                <td>{formatSp(entry.totalSp)}</td>
                <td className="muted">{formatDate(entry.character.refreshedAt)}</td>
                <td className="row-actions">
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() =>
                      void run('sync', () => mco.characters.sync(entry.character.id))
                    }
                  >
                    Sync
                  </button>
                  <button
                    type="button"
                    className="danger"
                    disabled={busy !== null}
                    onClick={() =>
                      void run('remove', () => mco.characters.remove(entry.character.id))
                    }
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
