import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AccountBucket, RosterEntry } from '@shared/types';
import { mco } from '../lib/ipc';

function AccountRow({
  account,
  characterCount,
  busy,
  onRename,
  onRemove,
}: {
  account: AccountBucket;
  characterCount: number;
  busy: boolean;
  onRename: (label: string) => void;
  onRemove: () => void;
}) {
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
      <td className="row-actions">
        <button type="button" className="danger" disabled={busy} onClick={onRemove}>
          Delete
        </button>
      </td>
    </tr>
  );
}

export default function Accounts() {
  const [accounts, setAccounts] = useState<AccountBucket[]>([]);
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [newAccount, setNewAccount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [a, r] = await Promise.all([mco.accounts.list(), mco.characters.roster()]);
    setAccounts(a);
    setRoster(r);
  }, []);

  useEffect(() => {
    void load().catch((e: unknown) => setError(String(e)));
  }, [load]);

  const counts = useMemo(() => {
    const map = new Map<number, number>();
    for (const entry of roster) {
      const id = entry.character.accountId;
      if (id !== null) map.set(id, (map.get(id) ?? 0) + 1);
    }
    return map;
  }, [roster]);

  async function run(action: () => Promise<unknown>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await action();
      await load();
    } catch (e) {
      setError(String(e));
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

  function removeAccount(account: AccountBucket): void {
    const count = counts.get(account.id) ?? 0;
    if (
      count > 0 &&
      !window.confirm(
        `"${account.label}" has ${count} character(s) assigned. Delete it and leave them unassigned?`,
      )
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
              <th aria-label="actions" />
            </tr>
          </thead>
          <tbody>
            {accounts.map((account) => (
              <AccountRow
                key={account.id}
                account={account}
                characterCount={counts.get(account.id) ?? 0}
                busy={busy}
                onRename={(label) => void run(() => mco.accounts.rename(account.id, label))}
                onRemove={() => removeAccount(account)}
              />
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
