import type { CharacterSummary, MiningCoverageEntry, MiningSummary } from '@shared/types';
import { SCOPE_READ_MINING } from '../config';
import { grantedScopes } from '../auth/token-store';
import { classifyEsiDataStatus, missingScopes } from '../auth/scopeStatus';
import { listAccounts } from '../db/repositories/accounts';
import { listCharacters } from '../db/repositories/characters';
import { getInvalidTokenIds } from '../db/repositories/tokens';
import {
  firstMiningDay,
  sumMiningByCharacter,
  sumMiningByDay,
  sumMiningByOre,
  sumMiningBySystem,
  sumMiningTotals,
} from '../db/repositories/characterMining';
import { fillMiningDays, miningWindowUtc } from '../mining/window';

/**
 * The Mining page: one window of the ledger, cut four ways.
 *
 * The same rows are aggregated by day, character, ore type and system rather
 * than shipped raw and grouped in the renderer — at 90+ characters × 30 days ×
 * a dozen ore types the raw ledger runs to tens of thousands of rows, and each
 * of the four questions ("when", "who", "what", "where") is a GROUP BY the
 * database already does well.
 */
export function buildMiningSummary(days: number | null): MiningSummary {
  const window = miningWindowUtc(days);

  const characters = listCharacters();
  const accounts = new Map(listAccounts().map((a) => [a.id, a.label]));
  const byId = new Map(characters.map((c) => [c.id, c]));
  const accountLabel = (character: CharacterSummary | undefined): string | null =>
    character?.accountId != null ? (accounts.get(character.accountId) ?? null) : null;

  const totals = sumMiningTotals(window);
  const coverage = miningCoverage(characters);

  return {
    window,
    totals: {
      units: totals.units,
      volumeM3: totals.volumeM3,
      oreTypes: totals.oreTypes,
      characters: totals.characters,
      systems: totals.systems,
    },
    byDay: fillMiningDays(window, sumMiningByDay(window)),
    byCharacter: sumMiningByCharacter(window).map((row) => ({
      ...row,
      // Ledger rows cascade away with the character, so an id with no name is
      // one removed between the aggregate and this lookup, not a stale row.
      characterName: byId.get(row.characterId)?.name ?? `Character ${row.characterId}`,
      accountLabel: accountLabel(byId.get(row.characterId)),
    })),
    byOre: sumMiningByOre(window),
    bySystem: sumMiningBySystem(window),
    typesMissingVolume: totals.typesMissingVolume,
    coverage,
    reportingCharacters: characters.length - coverage.length,
    firstRecordedDay: firstMiningDay(),
  };
}

/**
 * Characters whose token cannot report mining, so the totals are knowably
 * short. `pending` is deliberately not a gap here: with 90+ characters most of
 * them have simply never mined, and a synced character that stored no rows
 * looks exactly like one that spent the window ratting.
 */
function miningCoverage(characters: CharacterSummary[]): MiningCoverageEntry[] {
  const invalidTokens = getInvalidTokenIds();
  const gaps: MiningCoverageEntry[] = [];
  for (const character of characters) {
    const missing = missingScopes(grantedScopes(character.id), [SCOPE_READ_MINING]);
    const status = classifyEsiDataStatus({
      tokenInvalid: invalidTokens.has(character.id),
      missingScopes: missing,
      hasSynced: true,
    });
    if (status === 'ok') continue;
    gaps.push({
      characterId: character.id,
      characterName: character.name,
      status,
      missingScopes: missing,
    });
  }
  return gaps;
}
