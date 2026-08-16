import type { DashboardCharacterEntry, DashboardSummary, ServerStatus } from '@shared/types';
import { SCOPE_READ_ONLINE } from '../config';
import { hasGrantedScope } from '../auth/token-store';
import { getServerStatus } from '../esi/endpoints';
import { rateLimiter } from '../esi/rate-limiter';
import { listCharacters } from '../db/repositories/characters';
import { listCharacterOnline } from '../db/repositories/characterOnline';
import { sumWalletTotalsBetween } from '../db/repositories/characterWalletJournal';
import { getTotalSp } from '../db/repositories/skills';
import { currentMonthBoundsUtc } from '../wallet/monthIncome';

/** Bounds a promise so one slow/hung external call can't stall the whole dashboard. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    }),
  ]);
}

async function buildServerStatus(): Promise<ServerStatus> {
  try {
    const status = await withTimeout(getServerStatus(), 5000);
    return { online: true, players: status.players, vip: status.vip ?? false };
  } catch (err) {
    console.warn('ESI server-status check failed:', err);
    return { online: false, players: null, vip: false };
  }
}

/** Compose every stat the Dashboard page shows. */
export async function buildDashboardSummary(): Promise<DashboardSummary> {
  const characters = listCharacters();
  const onlineRows = new Map(listCharacterOnline().map((o) => [o.characterId, o]));

  const serverStatus = await buildServerStatus();
  const esiHealth = {
    healthy: rateLimiter.backoffMs === 0,
    backoffSeconds: Math.ceil(rateLimiter.backoffMs / 1000),
  };

  let onlineCount = 0;
  let missingScopeCount = 0;
  let totalSp = 0;
  const characterEntries: DashboardCharacterEntry[] = characters.map((character) => {
    if (onlineRows.get(character.id)?.online) onlineCount += 1;
    if (!hasGrantedScope(character.id, SCOPE_READ_ONLINE)) missingScopeCount += 1;
    const characterSp = getTotalSp(character.id);
    totalSp += characterSp;
    return { characterId: character.id, characterName: character.name, totalSp: characterSp };
  });

  const { start, end } = currentMonthBoundsUtc();
  // Only the income category is a Dashboard tile; the rest of the month's
  // totals (tax, donations, corp rewards) belong to the Wallet page.
  const { income } = sumWalletTotalsBetween(start, end);

  return {
    serverStatus,
    esiHealth,
    online: { onlineCount, missingScopeCount, totalCharacters: characters.length },
    charactersRegistered: characters.length,
    totalSp,
    income,
    characters: characterEntries,
  };
}
