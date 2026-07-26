import type { RattedIskSummary } from '@shared/types';
import { getDb } from '../index';

/**
 * ESI wallet-journal ref_types treated as "ratted ISK" for the Dashboard.
 * `BOUNTY_REF_TYPES` is the direct ratting category (NPC bounty payouts plus
 * null-sec ESS reserve-bank payouts of the same bounties); `MISSION_REF_TYPES`
 * is agent mission/incursion completion income. Kept as separate categories
 * (not just a combined sum) so the Dashboard can break them out.
 */
export const BOUNTY_REF_TYPES = ['bounty_prizes', 'ess_escrow_transfer'] as const;
export const MISSION_REF_TYPES = ['agent_mission_reward', 'agent_mission_time_bonus_reward'] as const;
export const TRACKED_REF_TYPES: readonly string[] = [...BOUNTY_REF_TYPES, ...MISSION_REF_TYPES];

export interface WalletJournalEntryInput {
  journalId: number;
  refType: string;
  amount: number;
  occurredAt: string;
}

/** Insert tracked journal entries, ignoring ones already stored (journal ids are immutable). */
export function upsertJournalEntries(characterId: number, entries: WalletJournalEntryInput[]): void {
  if (entries.length === 0) return;
  const stmt = getDb().prepare(
    `INSERT OR IGNORE INTO character_wallet_journal
       (character_id, journal_id, ref_type, amount, occurred_at)
     VALUES (@characterId, @journalId, @refType, @amount, @occurredAt)`,
  );
  const insertMany = getDb().transaction((rows: WalletJournalEntryInput[]) => {
    for (const row of rows) stmt.run({ characterId, ...row });
  });
  insertMany(entries);
}

interface SumRow {
  total: number | null;
}

function sumRefTypesBetween(
  refTypes: readonly string[],
  startIso: string,
  endIso: string,
): number {
  const placeholders = refTypes.map(() => '?').join(', ');
  const row = getDb()
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) AS total
       FROM character_wallet_journal
       WHERE ref_type IN (${placeholders})
         AND occurred_at >= ?
         AND occurred_at < ?`,
    )
    .get(...refTypes, startIso, endIso) as SumRow;
  return row.total ?? 0;
}

/** Ratted-ISK totals across every character, for occurred_at in [startIso, endIso). */
export function sumIncomeBetween(startIso: string, endIso: string): RattedIskSummary {
  const bountyIsk = sumRefTypesBetween(BOUNTY_REF_TYPES, startIso, endIso);
  const missionIsk = sumRefTypesBetween(MISSION_REF_TYPES, startIso, endIso);
  return { bountyIsk, missionIsk, totalIsk: bountyIsk + missionIsk };
}

export interface DailyIncomeRow {
  /** UTC calendar day, YYYY-MM-DD (ESI journal dates are UTC ISO strings). */
  day: string;
  bountyIsk: number;
  missionIsk: number;
}

interface DailyIncomeDbRow {
  day: string;
  bounty: number;
  mission: number;
}

/** Per-day ratted-ISK sums across every character, days with income only, ascending. */
export function sumIncomeByDayBetween(startIso: string, endIso: string): DailyIncomeRow[] {
  const bountyPlaceholders = BOUNTY_REF_TYPES.map(() => '?').join(', ');
  const missionPlaceholders = MISSION_REF_TYPES.map(() => '?').join(', ');
  const rows = getDb()
    .prepare(
      `SELECT substr(occurred_at, 1, 10) AS day,
              SUM(CASE WHEN ref_type IN (${bountyPlaceholders}) THEN amount ELSE 0 END) AS bounty,
              SUM(CASE WHEN ref_type IN (${missionPlaceholders}) THEN amount ELSE 0 END) AS mission
       FROM character_wallet_journal
       WHERE occurred_at >= ? AND occurred_at < ?
       GROUP BY day
       ORDER BY day`,
    )
    .all(...BOUNTY_REF_TYPES, ...MISSION_REF_TYPES, startIso, endIso) as DailyIncomeDbRow[];
  return rows.map((row) => ({ day: row.day, bountyIsk: row.bounty, missionIsk: row.mission }));
}
