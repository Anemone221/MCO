import type { WalletDayTotals, WalletMonthTotals, WalletTotals } from '@shared/types';
import { getDb } from '../index';

/**
 * ESI wallet-journal ref_types the Wallet page tracks. `BOUNTY_REF_TYPES` is
 * the direct ratting category (NPC bounty payouts plus null-sec ESS reserve-bank
 * payouts of the same bounties); `MISSION_REF_TYPES` is agent mission/incursion
 * completion income. Kept as separate categories (not just a combined sum) so
 * the Dashboard and Wallet tiles can break them out.
 */
export const BOUNTY_REF_TYPES = ['bounty_prizes', 'ess_escrow_transfer'] as const;
export const MISSION_REF_TYPES = ['agent_mission_reward', 'agent_mission_time_bonus_reward'] as const;
/**
 * Reward payouts. Despite the name this is not a corp project: the payer is
 * CONCORD (`first_party_id` 1000125, "CONCORD rewarded <name> for services
 * performed") paying out a completed site, which makes it PvE income like a
 * bounty.
 *
 * ESI reports the **net** amount. In-game the journal shows the gross payout
 * and a matching `corporate_reward_tax` row for the corp's cut (45M / -4.5M);
 * ESI's character journal carries neither — just the 40.5M that landed. So
 * this figure is correct as "what was earned", and that corp tax is not
 * something the tax total can ever include (see `TAX_REF_TYPE_SUFFIX`).
 */
export const CORP_REWARD_REF_TYPES = ['corporate_reward_payout'] as const;
/** ISK sent between players (and to/from corps); the sign says which way it went. */
export const DONATION_REF_TYPES = ['player_donation'] as const;

/**
 * Tax is matched by suffix rather than by a list. ESI has ~17 `*_tax`
 * ref_types today (sales, contract, reprocessing, industry/market/bounty
 * security, corp tax on bounties and mission rewards, …) and CCP adds more
 * with each new activity — an explicit list would quietly under-report every
 * time. Every ref_type ending in `_tax` is a deduction, so the suffix is the
 * rule.
 *
 * What this cannot see: tax ESI never reports. The in-game journal shows a
 * `Corporate Reward Tax` row against each CONCORD reward payout, but ESI's
 * character journal returns neither that row nor a `tax` field — only the
 * already-net payout. The tax total is therefore "tax ESI told us about",
 * which is why the Wallet card says so.
 */
const TAX_REF_TYPE_SUFFIX = '_tax';
/** SQL for the same rule; `\` escapes the underscore so it is a literal, not a wildcard. */
const TAX_REF_TYPE_MATCH = String.raw`ref_type LIKE '%\_tax' ESCAPE '\'`;

/**
 * Costs of doing business. Fees follow the same pattern tax does — a `_fee`
 * suffix, from contract broker fees to jump-clone installation — so they get
 * a suffix rule too, and the handful of costs CCP named differently are listed
 * out. Only the negative side counts, so a refunded fee cannot read as spending.
 *
 * Deliberately excluded: `market_escrow` (ISK parked against a buy order, not
 * spent), `player_trading` and `corporation_account_withdrawal` (moving your own
 * ISK around), and the contract ref_types — a contract can be a purchase or a
 * sale, and guessing which would make this number fiction.
 */
const EXPENSE_REF_TYPE_SUFFIX = '_fee';
const EXPENSE_REF_TYPE_MATCH = String.raw`ref_type LIKE '%\_fee' ESCAPE '\'`;
export const EXPENSE_REF_TYPES = [
  'skill_purchase',
  'structure_gate_jump',
  'planetary_construction',
  'repair_bill',
] as const;

/** Whether a journal entry is one of the categories worth storing. */
export function isTrackedRefType(refType: string): boolean {
  return (
    refType.endsWith(TAX_REF_TYPE_SUFFIX) ||
    refType.endsWith(EXPENSE_REF_TYPE_SUFFIX) ||
    (BOUNTY_REF_TYPES as readonly string[]).includes(refType) ||
    (MISSION_REF_TYPES as readonly string[]).includes(refType) ||
    (CORP_REWARD_REF_TYPES as readonly string[]).includes(refType) ||
    (DONATION_REF_TYPES as readonly string[]).includes(refType) ||
    (EXPENSE_REF_TYPES as readonly string[]).includes(refType)
  );
}

export interface WalletJournalEntryInput {
  journalId: number;
  refType: string;
  amount: number;
  /** Tax withheld at source (0 when none): a taxed bounty pays out net of this. */
  tax: number;
  /** Sender / receiver. Null when ESI omits them; only donations read them. */
  firstPartyId: number | null;
  secondPartyId: number | null;
  occurredAt: string;
}

/**
 * Insert tracked journal entries. Journal ids are immutable, so a conflict is
 * the same entry seen again — the columns are refreshed anyway, which backfills
 * rows stored before `tax` and the party ids existed (migration 30).
 */
export function upsertJournalEntries(characterId: number, entries: WalletJournalEntryInput[]): void {
  if (entries.length === 0) return;
  const stmt = getDb().prepare(
    `INSERT INTO character_wallet_journal
       (character_id, journal_id, ref_type, amount, tax, first_party_id, second_party_id, occurred_at)
     VALUES (@characterId, @journalId, @refType, @amount, @tax, @firstPartyId, @secondPartyId, @occurredAt)
     ON CONFLICT (character_id, journal_id) DO UPDATE SET
       tax             = excluded.tax,
       first_party_id  = excluded.first_party_id,
       second_party_id = excluded.second_party_id`,
  );
  const insertMany = getDb().transaction((rows: WalletJournalEntryInput[]) => {
    for (const row of rows) stmt.run({ characterId, ...row });
  });
  insertMany(entries);
}

interface TotalsRow {
  bounty: number;
  mission: number;
  corp_reward: number;
  tax_paid: number;
  expenses: number;
  donation_in: number;
  donation_out: number;
  internal_transfer: number;
}

/**
 * The aggregate columns every totals query selects, with their bound ref_type
 * parameters in the order the SQL consumes them (the template literal below
 * evaluates left to right, which is what keeps the two in step).
 *
 * Outgoings come back positive: `-amount` on the rows that took ISK. A
 * donation is "internal" when the counterparty is another tracked character —
 * ISK moved between the user's own wallets, which is neither income nor
 * spending. Only the receiving side is counted, so a transfer between two
 * synced characters lands once rather than on both wallets' rows.
 */
function aggregateColumns(): { sql: string; params: string[] } {
  const params: string[] = [];
  const list = (refTypes: readonly string[]): string => {
    params.push(...refTypes);
    return refTypes.map(() => '?').join(', ');
  };
  // 0 stands in for a missing party id: never a real character id, so a row
  // ESI gave no counterparty for reads as external rather than vanishing.
  const tracked = (column: string): string =>
    `IFNULL(${column}, 0) IN (SELECT id FROM characters)`;

  const sql = `
    COALESCE(SUM(CASE WHEN ref_type IN (${list(BOUNTY_REF_TYPES)}) THEN amount ELSE 0 END), 0) AS bounty,
    COALESCE(SUM(CASE WHEN ref_type IN (${list(MISSION_REF_TYPES)}) THEN amount ELSE 0 END), 0) AS mission,
    COALESCE(SUM(CASE WHEN ref_type IN (${list(CORP_REWARD_REF_TYPES)}) THEN amount ELSE 0 END), 0) AS corp_reward,
    COALESCE(SUM(CASE WHEN ${TAX_REF_TYPE_MATCH} AND amount < 0 THEN -amount ELSE 0 END), 0)
      + COALESCE(SUM(tax), 0) AS tax_paid,
    COALESCE(SUM(CASE WHEN (${EXPENSE_REF_TYPE_MATCH} OR ref_type IN (${list(EXPENSE_REF_TYPES)}))
                        AND amount < 0 THEN -amount ELSE 0 END), 0) AS expenses,
    COALESCE(SUM(CASE WHEN ref_type IN (${list(DONATION_REF_TYPES)}) AND amount > 0
                        AND NOT ${tracked('first_party_id')} THEN amount ELSE 0 END), 0) AS donation_in,
    COALESCE(SUM(CASE WHEN ref_type IN (${list(DONATION_REF_TYPES)}) AND amount < 0
                        AND NOT ${tracked('second_party_id')} THEN -amount ELSE 0 END), 0) AS donation_out,
    COALESCE(SUM(CASE WHEN ref_type IN (${list(DONATION_REF_TYPES)}) AND amount > 0
                        AND ${tracked('first_party_id')} THEN amount ELSE 0 END), 0) AS internal_transfer`;

  return { sql, params };
}

function toTotals(row: TotalsRow): WalletTotals {
  return {
    income: {
      bountyIsk: row.bounty,
      missionIsk: row.mission,
      corpRewardIsk: row.corp_reward,
      totalIsk: row.bounty + row.mission + row.corp_reward,
    },
    taxIsk: row.tax_paid,
    expenseIsk: row.expenses,
    donationsInIsk: row.donation_in,
    donationsOutIsk: row.donation_out,
    internalTransferIsk: row.internal_transfer,
  };
}

/** Every tracked category summed across all characters, for occurred_at in [startIso, endIso). */
export function sumWalletTotalsBetween(startIso: string, endIso: string): WalletTotals {
  const { sql, params } = aggregateColumns();
  const row = getDb()
    .prepare(
      `SELECT ${sql}
       FROM character_wallet_journal
       WHERE occurred_at >= ? AND occurred_at < ?`,
    )
    .get(...params, startIso, endIso) as TotalsRow;
  return toTotals(row);
}

interface MonthTotalsRow extends TotalsRow {
  month: string;
}

/** The same totals grouped by UTC calendar month, months with activity only, ascending. */
export function sumWalletTotalsByMonth(startIso: string, endIso: string): WalletMonthTotals[] {
  const { sql, params } = aggregateColumns();
  const rows = getDb()
    .prepare(
      `SELECT substr(occurred_at, 1, 7) AS month,
              ${sql}
       FROM character_wallet_journal
       WHERE occurred_at >= ? AND occurred_at < ?
       GROUP BY month
       ORDER BY month`,
    )
    .all(...params, startIso, endIso) as MonthTotalsRow[];
  return rows.map((row) => ({ month: row.month, ...toTotals(row) }));
}

interface DayTotalsRow extends TotalsRow {
  day: string;
}

/**
 * The same totals grouped by UTC calendar day, days with activity only,
 * ascending. ESI journal dates are UTC ISO strings, so the first 10 characters
 * are the calendar day.
 */
export function sumWalletTotalsByDay(startIso: string, endIso: string): WalletDayTotals[] {
  const { sql, params } = aggregateColumns();
  const rows = getDb()
    .prepare(
      `SELECT substr(occurred_at, 1, 10) AS day,
              ${sql}
       FROM character_wallet_journal
       WHERE occurred_at >= ? AND occurred_at < ?
       GROUP BY day
       ORDER BY day`,
    )
    .all(...params, startIso, endIso) as DayTotalsRow[];
  return rows.map((row) => ({ day: row.day, ...toTotals(row) }));
}
