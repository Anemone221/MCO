import type {
  CharacterSummary,
  MercenaryBoard,
  MercenaryCoverageEntry,
  MercenaryDenEntry,
  MercenaryOperationEntry,
} from '@shared/types';
import { SCOPE_READ_ACTIVITIES, SCOPE_READ_CHARACTER_STRUCTURES } from '../config';
import { grantedScopesByCharacter } from '../auth/token-store';
import { classifyEsiDataStatus, missingScopes } from '../auth/scopeStatus';
import {
  getCharacterMercenaryDens,
  getCharacterMercenaryOperations,
  getCorporationPublic,
  getMercenaryDen,
  getMercenaryOperation,
} from '../esi/endpoints';
import { listAccounts } from '../db/repositories/accounts';
import { listCharacters } from '../db/repositories/characters';
import { getInvalidTokenIds } from '../db/repositories/tokens';
import {
  getMercenaryDenSyncedIds,
  listMercenaryDens,
  listMercenaryOperations,
  replaceMercenaryDens,
  replaceMercenaryOperations,
  updateMercenaryDenDetail,
  updateMercenaryOperationDetail,
} from '../db/repositories/mercenaryDens';
import { getPlanets } from '../db/repositories/planets';
import { getSystems, getTypeNames } from '../db/repositories/sde';
import {
  ANARCHY_ALERT_LEVEL,
  denAttention,
  denStatus,
  isOpenOperation,
  isReinforced,
  mercenaryLevel,
  operationStatus,
} from '../mercenary/den';

/**
 * Mercenary Dens: the sync half (two ESI listings, each with a detail
 * fan-out) and the board half (those rows joined to planets, systems and
 * SDE names).
 *
 * Both halves live here because they are the same shape of thing seen from
 * two ends, and neither is large enough to earn a file of its own.
 */

// ---------------------------------------------------------------------------
// Sync

/**
 * Ceiling on den detail reads per character per sweep.
 *
 * The Mercenary Den Management skill caps a character at five dens (one per
 * level), so this is a guard against a surprise, not a stopping rule — the
 * listing is the stopping rule. Set above the game's cap on purpose: if CCP
 * raises it, MCO reads the extra dens rather than silently hiding them.
 */
const MAX_DEN_DETAILS = 10;

/**
 * Ceiling on operation detail reads per character per sweep.
 *
 * Unlike dens there is no skill capping this — a character with five dens has
 * offers standing at all of them — so across 90 characters it is the one place
 * this feature could turn a sweep into a burst. Offers are read newest-listing
 * first and the rest wait for the next sweep.
 */
const MAX_OPERATION_DETAILS = 25;

/**
 * Pull one character's Mercenary Dens.
 *
 * The listing gives ids and planets only, so every den costs a second request
 * to learn anything about it. Each detail is caught on its own: one den that
 * fails must not cost the character the other four, and the listing has
 * already recorded that the den exists.
 *
 * Returns the planet ids seen, for the driver to resolve into addresses.
 */
export async function syncMercenaryDens(characterId: number): Promise<number[]> {
  const listing = await getCharacterMercenaryDens(characterId);
  const dens = listing.mercenary_dens;

  replaceMercenaryDens(
    characterId,
    dens.map((den) => ({ denId: den.id, planetId: den.planet_id })),
  );

  for (const den of dens.slice(0, MAX_DEN_DETAILS)) {
    try {
      const detail = await getMercenaryDen(characterId, den.id);
      updateMercenaryDenDetail({
        denId: den.id,
        typeId: detail.type_id,
        state: detail.state,
        skyhookId: detail.skyhook.id,
        skyhookCorporationId: detail.skyhook.corporation_id,
        skyhookCorporationName: await skyhookCorporationName(detail.skyhook.corporation_id),
        infomorphs: detail.infomorphs.amount,
        developmentAmount: detail.evolution.development.amount,
        developmentLevel: mercenaryLevel(detail.evolution.development.level),
        anarchyAmount: detail.evolution.anarchy.amount,
        anarchyLevel: mercenaryLevel(detail.evolution.anarchy.level),
        reinforcementEnd: detail.reinforcement_timer?.end ?? null,
      });
    } catch (err) {
      console.warn(`Mercenary den ${den.id} detail failed for character ${characterId}:`, err);
    }
  }

  return dens.map((den) => den.planet_id);
}

/**
 * The skyhook owner's name, or null.
 *
 * Public, and the ESI response cache dedupes it — a roster's dens sit on a
 * handful of distinct sov holders' skyhooks, so this is one request per
 * corporation per cache window however many dens reference it. Never throws:
 * an unnamed owner is a cosmetic gap, and the id is stored either way.
 */
async function skyhookCorporationName(corporationId: number): Promise<string | null> {
  try {
    return (await getCorporationPublic(corporationId)).name;
  } catch (err) {
    console.warn(`Skyhook corporation ${corporationId} lookup failed:`, err);
    return null;
  }
}

/**
 * Pull one character's Mercenary Tactical Operation offers.
 *
 * Offers are listed against the character, not the den — each carries the den
 * it belongs to — so this is one listing per character regardless of how many
 * dens it holds, plus a detail per offer for the state, dungeon and expiry
 * that the listing omits.
 */
export async function syncMercenaryOperations(characterId: number): Promise<void> {
  const listing = await getCharacterMercenaryOperations(characterId);
  const operations = listing.operations;

  replaceMercenaryOperations(
    characterId,
    operations.map((op) => ({ operationId: op.id, denId: op.mercenary_den_id })),
  );

  for (const op of operations.slice(0, MAX_OPERATION_DETAILS)) {
    try {
      const detail = await getMercenaryOperation(characterId, op.id);
      updateMercenaryOperationDetail({
        operationId: op.id,
        state: detail.state,
        dungeonTypeId: detail.dungeon_type_id,
        expires: detail.expires,
      });
    } catch (err) {
      console.warn(`Mercenary operation ${op.id} detail failed for character ${characterId}:`, err);
    }
  }
}

// ---------------------------------------------------------------------------
// Board

/**
 * The Mercenary Dens page.
 *
 * Dens are the row, not characters: one character holds up to five, and every
 * question the page answers — is it reinforced, is anarchy climbing, is there
 * an operation waiting — is asked of a den. Characters that hold none simply
 * don't appear, which is what keeps the page short on a 90-character roster
 * where most characters have never anchored one.
 */
export function buildMercenaryBoard(): MercenaryBoard {
  const now = new Date();
  const characters = listCharacters();
  const byId = new Map(characters.map((c) => [c.id, c]));
  const accounts = new Map(listAccounts().map((a) => [a.id, a.label]));

  const denRows = listMercenaryDens();
  const operationRows = listMercenaryOperations();

  const planets = getPlanets([...new Set(denRows.map((d) => d.planetId))]);
  const systems = getSystems([
    ...new Set(
      [...planets.values()].flatMap((p) => (p.solarSystemId !== null ? [p.solarSystemId] : [])),
    ),
  ]);
  const typeNames = getTypeNames([
    ...new Set([
      ...denRows.flatMap((d) => (d.typeId !== null ? [d.typeId] : [])),
      ...operationRows.flatMap((o) => (o.dungeonTypeId !== null ? [o.dungeonTypeId] : [])),
    ]),
  ]);

  // Offers indexed by den, so each den's row is a lookup rather than a scan.
  const operationsByDen = new Map<number, MercenaryOperationEntry[]>();
  for (const row of operationRows) {
    const entry: MercenaryOperationEntry = {
      operationId: row.operationId,
      denId: row.denId,
      status: operationStatus({ state: row.state, expires: row.expires, now }),
      dungeonName: row.dungeonTypeId !== null ? (typeNames.get(row.dungeonTypeId) ?? null) : null,
      dungeonTypeId: row.dungeonTypeId,
      expires: row.expires,
    };
    const list = operationsByDen.get(row.denId);
    if (list) list.push(entry);
    else operationsByDen.set(row.denId, [entry]);
  }

  const dens: MercenaryDenEntry[] = denRows.map((row) => {
    const character = byId.get(row.characterId);
    const planet = planets.get(row.planetId);
    const system = planet?.solarSystemId != null ? systems.get(planet.solarSystemId) : undefined;
    const status = denStatus({ state: row.state, reinforcementEnd: row.reinforcementEnd, now });

    const operations = (operationsByDen.get(row.denId) ?? []).sort(compareOperations);
    const openOperations = operations.filter((op) => isOpenOperation(op.status)).length;

    return {
      denId: row.denId,
      characterId: row.characterId,
      // A den's rows cascade away with its character, so an id with no name is
      // one removed between the two reads above, not a stale row.
      characterName: character?.name ?? `Character ${row.characterId}`,
      accountLabel:
        character?.accountId != null ? (accounts.get(character.accountId) ?? null) : null,
      planetId: row.planetId,
      planetName: planet?.name ?? null,
      solarSystemId: planet?.solarSystemId ?? null,
      systemName: system?.name ?? null,
      regionName: system?.regionName ?? null,
      security: system?.security ?? null,
      status,
      typeName: row.typeId !== null ? (typeNames.get(row.typeId) ?? null) : null,
      typeId: row.typeId,
      skyhookCorporationId: row.skyhookCorporationId,
      skyhookCorporationName: row.skyhookCorporationName,
      development: { amount: row.developmentAmount, level: row.developmentLevel },
      anarchy: { amount: row.anarchyAmount, level: row.anarchyLevel },
      infomorphs: row.infomorphs,
      // Only surfaced while it is actually running: a timer whose end has
      // passed is a den that came out, not one still in.
      reinforcementEnd: isReinforced(row.reinforcementEnd, now) ? row.reinforcementEnd : null,
      operations,
      openOperations,
      attention: denAttention({ status, anarchyLevel: row.anarchyLevel, openOperations }),
      detailSyncedAt: row.detailSyncedAt,
      updatedAt: row.updatedAt,
    };
  });

  dens.sort(compareDens);

  const coverage = mercenaryCoverage(characters);

  return {
    dens,
    totals: {
      dens: dens.length,
      holders: new Set(dens.map((d) => d.characterId)).size,
      reinforced: dens.filter((d) => d.status === 'reinforced').length,
      disabled: dens.filter((d) => d.status === 'disabled').length,
      highAnarchy: dens.filter(
        (d) => d.anarchy.level !== null && d.anarchy.level >= ANARCHY_ALERT_LEVEL,
      ).length,
      openOperations: dens.reduce((sum, d) => sum + d.openOperations, 0),
    },
    coverage,
    reportingCharacters: characters.length - coverage.length,
    unresolvedPlanets: dens.filter((d) => d.planetName === null).length,
  };
}

/**
 * Default order: whatever needs attention first, then soonest deadline, then
 * a stable alphabetical fallback so re-renders don't shuffle equal rows.
 */
function compareDens(a: MercenaryDenEntry, b: MercenaryDenEntry): number {
  if (a.attention !== b.attention) return b.attention - a.attention;
  if (a.reinforcementEnd !== b.reinforcementEnd) {
    if (a.reinforcementEnd === null) return 1;
    if (b.reinforcementEnd === null) return -1;
    return a.reinforcementEnd.localeCompare(b.reinforcementEnd);
  }
  return (
    a.characterName.localeCompare(b.characterName) ||
    (a.planetName ?? '').localeCompare(b.planetName ?? '')
  );
}

/** Offers you can act on first, then the soonest to lapse. */
function compareOperations(a: MercenaryOperationEntry, b: MercenaryOperationEntry): number {
  const openA = isOpenOperation(a.status) ? 0 : 1;
  const openB = isOpenOperation(b.status) ? 0 : 1;
  if (openA !== openB) return openA - openB;
  if (a.expires === null) return b.expires === null ? 0 : 1;
  if (b.expires === null) return -1;
  return a.expires.localeCompare(b.expires);
}

/**
 * Characters whose token cannot report dens or operations, so the board is
 * knowably short.
 *
 * `pending` counts here, unlike the mining ledger's coverage: a character that
 * has synced and reported no dens genuinely holds none, but one that has never
 * been swept may hold five — and both look like an empty board until the first
 * listing lands. Whether a listing has ever landed is exactly what
 * `mercenary_den_sync` records.
 */
function mercenaryCoverage(characters: CharacterSummary[]): MercenaryCoverageEntry[] {
  const invalidTokens = getInvalidTokenIds();
  const synced = getMercenaryDenSyncedIds();
  const scopes = grantedScopesByCharacter();
  const gaps: MercenaryCoverageEntry[] = [];

  for (const character of characters) {
    const missing = missingScopes(scopes.get(character.id) ?? [], [
      SCOPE_READ_CHARACTER_STRUCTURES,
      SCOPE_READ_ACTIVITIES,
    ]);
    const status = classifyEsiDataStatus({
      tokenInvalid: invalidTokens.has(character.id),
      missingScopes: missing,
      hasSynced: synced.has(character.id),
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
