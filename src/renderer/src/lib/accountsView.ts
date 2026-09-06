import type { AccountBucket, RosterEntry } from '@shared/types';

/** One row of the Accounts table: the bucket plus what its characters are doing. */
export interface AccountRowView {
  account: AccountBucket;
  /** Characters assigned to this account. */
  characterCount: number;
  /** How many of them are training right now (more than one means MCT). */
  trainingCount: number;
  /**
   * Omega, has characters, none of them training — training time being paid
   * for and not spent. The same condition the `omega-idle` notification
   * raises (`main/notifications/idleOmega.ts`); this is the page's copy of it,
   * so the table says the same thing the toast did.
   */
  idleOmega: boolean;
}

/**
 * Join the account buckets to the roster, in the order the accounts came in
 * (the repository sorts them by label).
 */
export function buildAccountRows(
  accounts: AccountBucket[],
  roster: RosterEntry[],
): AccountRowView[] {
  const characterCounts = new Map<number, number>();
  const trainingCounts = new Map<number, number>();
  for (const entry of roster) {
    const accountId = entry.character.accountId;
    if (accountId === null) continue;
    characterCounts.set(accountId, (characterCounts.get(accountId) ?? 0) + 1);
    if (entry.training.isTraining) {
      trainingCounts.set(accountId, (trainingCounts.get(accountId) ?? 0) + 1);
    }
  }

  return accounts.map((account) => {
    const characterCount = characterCounts.get(account.id) ?? 0;
    const trainingCount = trainingCounts.get(account.id) ?? 0;
    return {
      account,
      characterCount,
      trainingCount,
      idleOmega: account.isOmega && characterCount > 0 && trainingCount === 0,
    };
  });
}

/** The idle Omega accounts, for the alert that names them. */
export function idleOmegaAccounts(rows: AccountRowView[]): AccountRowView[] {
  return rows.filter((row) => row.idleOmega);
}
