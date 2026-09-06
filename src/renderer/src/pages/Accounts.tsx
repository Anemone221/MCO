import { useEffect, useMemo, useState } from 'react';
import type { AccountBucket } from '@shared/types';
import { errorMessage, mco } from '../lib/ipc';
import { buildAccountRows, idleOmegaAccounts, type AccountRowView } from '../lib/accountsView';
import { useMcoData } from '../lib/useMcoData';

/**
 * What the account's characters are doing. Omega training nobody is the one
 * alarming case — the subscription is paying for a training slot standing
 * empty — so it is the only warn-coloured chip here; an idle Alpha is routine.
 */
function TrainingCell({ row }: { row: AccountRowView }) {
  if (row.characterCount === 0) return <span className="muted">—</span>;
  if (row.idleOmega) {
    return (
      <span className="chip chip--warn" data-testid={`account-idle-${row.account.id}`}>
        Nobody training
      </span>
    );
  }
  if (row.trainingCount === 0) return <span className="chip chip--idle">Idle</span>;
  return (
    <span className="chip chip--ok">
      Training{row.trainingCount > 1 ? ` ×${row.trainingCount}` : ''}
    </span>
  );
}

function AccountRow({
  row,
  busy,
  onRename,
  onSetOmega,
  onRemove,
}: {
  row: AccountRowView;
  busy: boolean;
  onRename: (label: string) => void;
  onSetOmega: (isOmega: boolean) => void;
  onRemove: () => void;
}) {
  const { account, characterCount } = row;
  const [name, setName] = useState(account.label);

  useEffect(() => {
    setName(account.label);
  }, [account.label]);

  function commit(): void {
    const trimmed = name.trim();
    if (trimmed && trimmed !== account.label) onRename(trimmed);
    else setName(account.label);
  }

  return (
    <tr data-testid={`account-row-${account.id}`}>
      <td>
        <input
          className="account-name"
          value={name}
          disabled={busy}
          onChange={(e) => setName(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
          data-testid={`account-name-${account.id}`}
        />
      </td>
      <td>{characterCount}</td>
      <td>
        <TrainingCell row={row} />
      </td>
      <td>
        <label className="omega-toggle">
          <input
            type="checkbox"
            checked={account.isOmega}
            disabled={busy}
            onChange={(e) => onSetOmega(e.target.checked)}
            data-testid={`account-omega-${account.id}`}
          />{' '}
          Omega
        </label>
      </td>
      <td className="row-actions">
        <button type="button" className="danger btn-sm" disabled={busy} onClick={onRemove}>
          Delete
        </button>
      </td>
    </tr>
  );
}

export default function Accounts() {
  const [newAccount, setNewAccount] = useState('');
  const [busy, setBusy] = useState(false);

  const { data, error, reload, setError } = useMcoData(async () => {
    const [accounts, roster] = await Promise.all([mco.accounts.list(), mco.characters.roster()]);
    return { accounts, roster };
  });
  const { accounts = [], roster = [] } = data ?? {};

  const rows = useMemo(() => buildAccountRows(accounts, roster), [accounts, roster]);
  const idle = useMemo(() => idleOmegaAccounts(rows), [rows]);

  async function run(action: () => Promise<unknown>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await action();
      await reload();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function createAccount(): Promise<void> {
    const label = newAccount.trim();
    if (!label) return;
    setNewAccount('');
    await run(() => mco.accounts.create(label));
  }

  async function removeAccount(account: AccountBucket, count: number): Promise<void> {
    if (
      count > 0 &&
      !(await mco.system.confirm(
        `"${account.label}" has ${count} character(s) assigned. Delete it and leave them unassigned?`,
        'Delete',
      ))
    ) {
      return;
    }
    void run(() => mco.accounts.remove(account.id));
  }

  return (
    <section className="page">
      <div className="toolbar">
        <h2>Accounts ({accounts.length})</h2>
      </div>

      <div className="card">
        <h3>Add account</h3>
        <div className="toolbar__actions">
          <input
            value={newAccount}
            placeholder="Account name"
            disabled={busy}
            onChange={(e) => setNewAccount(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void createAccount();
            }}
            data-testid="new-account-input"
          />
          <button type="button" disabled={busy} onClick={() => void createAccount()} data-testid="add-account">
            Add
          </button>
        </div>
      </div>

      {error && <div className="error-box" data-testid="accounts-error">{error}</div>}

      {idle.length > 0 && (
        <div className="warn-box" data-testid="omega-idle-alert">
          <strong>Omega training time going to waste</strong> — nobody is training on{' '}
          {idle.map((row) => row.account.label).join(', ')}.
        </div>
      )}

      {accounts.length === 0 ? (
        <div className="empty-state">
          <h3>No accounts yet</h3>
          <p>Add an account above, then assign characters to it from the Roster page.</p>
        </div>
      ) : (
        <table className="data-table" data-testid="accounts-table">
          <thead>
            <tr>
              <th>Account name</th>
              <th>Characters</th>
              <th>Training</th>
              <th>Status</th>
              <th aria-label="actions" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <AccountRow
                key={row.account.id}
                row={row}
                busy={busy}
                onRename={(label) => void run(() => mco.accounts.rename(row.account.id, label))}
                onSetOmega={(isOmega) =>
                  void run(() => mco.accounts.setOmega(row.account.id, isOmega))
                }
                onRemove={() => void removeAccount(row.account, row.characterCount)}
              />
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
