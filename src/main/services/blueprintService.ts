import type {
  BlueprintBoard,
  BlueprintCharacterCoverage,
  BlueprintCorpStatus,
} from '@shared/types';
import { SCOPE_READ_BLUEPRINTS, SCOPE_READ_CORP_BLUEPRINTS } from '../config';
import { startLogin } from '../auth/esi-oauth';
import { grantedScopes, hasGrantedScope } from '../auth/token-store';
import { classifyEsiDataStatus, missingScopes } from '../auth/scopeStatus';
import { UserFacingError } from '../errors';
import { EsiHttpError } from '../esi/client';
import {
  getCharacterBlueprints,
  getCharacterPublic,
  getCorporationBlueprints,
  getCorporationPublic,
  type EsiBlueprint,
} from '../esi/endpoints';
import {
  getCharacterBlueprintSyncTimes,
  listBlueprintCorps,
  listCharacterBlueprints,
  listCorporationBlueprints,
  markBlueprintCorpError,
  removeBlueprintCorp,
  replaceCharacterBlueprints,
  replaceCorporationBlueprints,
  upsertBlueprintCorp,
  type BlueprintCorpRow,
  type OwnedBlueprintRow,
} from '../db/repositories/blueprints';
import { getCharacter, listCharacters, upsertCharacter } from '../db/repositories/characters';
import { getInvalidTokenIds } from '../db/repositories/tokens';
import { getBlueprintCatalog } from '../db/repositories/sde';
import { buildOwnership, holderKey, type HoldingInput } from '../blueprints/ownership';

/** ESI's blueprint shape, as this app stores it. */
function toOwnedRows(entries: EsiBlueprint[]): OwnedBlueprintRow[] {
  return entries.map((e) => ({
    itemId: e.item_id,
    typeId: e.type_id,
    quantity: e.quantity,
    runs: e.runs,
    materialEfficiency: e.material_efficiency,
    timeEfficiency: e.time_efficiency,
    locationId: e.location_id,
    locationFlag: e.location_flag,
  }));
}

/**
 * Pull one character's own blueprints. Scope-gated by the caller; called from
 * the character sync as one more best-effort block.
 *
 * A failed read throws rather than storing what it got: the rows replace the
 * holder's stored blueprints wholesale, so a partial list would delete the ones
 * the missing pages carried and the hangar would appear to shrink because a
 * request timed out.
 */
export async function syncCharacterBlueprints(characterId: number): Promise<void> {
  replaceCharacterBlueprints(characterId, toOwnedRows(await getCharacterBlueprints(characterId)));
}

/**
 * How long a corp whose last read failed is left alone. A 403 (reader lost
 * Director, or never had it) is not going to fix itself within the hour, and
 * each retry spends an ESI error-limit slot — so scheduled sweeps back off and
 * only an explicit refresh from the page retries immediately.
 */
const CORP_ERROR_COOLDOWN_MS = 6 * 60 * 60 * 1000;

function corpErrorMessage(err: unknown, corp: BlueprintCorpRow, readerName: string): string {
  if (err instanceof EsiHttpError && err.status === 403) {
    return (
      `${readerName} cannot read ${corp.name ?? `corporation ${corp.corporationId}`}'s ` +
      `blueprints — ESI requires the Director role. Grant the role in game, or add the ` +
      `corp again with a character that has it.`
    );
  }
  if (err instanceof EsiHttpError) return `ESI returned ${err.status} for this corporation.`;
  return 'Could not read this corporation’s blueprints. See Settings → Export logs.';
}

function isInErrorCooldown(corp: BlueprintCorpRow): boolean {
  if (corp.lastError === null || corp.lastErrorAt === null) return false;
  const at = new Date(corp.lastErrorAt).getTime();
  return !Number.isNaN(at) && Date.now() - at < CORP_ERROR_COOLDOWN_MS;
}

/**
 * Read every tracked corporation's blueprint hangar through its reader token.
 * One corp costs one request per ESI cache window regardless of how many
 * characters sit in it, which is the whole point of designating a reader.
 * Never throws: a corp that fails records why and the others still sync.
 */
export async function syncBlueprintCorps(options: { force?: boolean } = {}): Promise<void> {
  const invalid = getInvalidTokenIds();

  for (const corp of listBlueprintCorps()) {
    if (!options.force && isInErrorCooldown(corp)) continue;

    const reader = getCharacter(corp.readerCharacterId);
    const readerName = reader?.name ?? `character ${corp.readerCharacterId}`;
    if (invalid.has(corp.readerCharacterId)) {
      markBlueprintCorpError(
        corp.corporationId,
        `${readerName}'s login has expired — re-add that character to keep reading this corp.`,
      );
      continue;
    }
    if (!hasGrantedScope(corp.readerCharacterId, SCOPE_READ_CORP_BLUEPRINTS)) {
      markBlueprintCorpError(
        corp.corporationId,
        `${readerName} no longer grants ${SCOPE_READ_CORP_BLUEPRINTS} — add the corp again to re-grant it.`,
      );
      continue;
    }

    try {
      const entries = await getCorporationBlueprints(corp.corporationId, corp.readerCharacterId);
      replaceCorporationBlueprints(corp.corporationId, toOwnedRows(entries));
    } catch (err) {
      console.warn(`Corp blueprint sync failed for ${corp.corporationId}:`, err);
      markBlueprintCorpError(corp.corporationId, corpErrorMessage(err, corp, readerName));
    }
  }
}

/**
 * Player corporations start well above this; NPC corps (the ones every new
 * character starts in) sit in the low millions and have no blueprint hangar.
 */
const MIN_PLAYER_CORP_ID = 2_000_000;

/**
 * Track a corporation's blueprint hangar.
 *
 * Runs SSO for one character with the opt-in corporation scope added, then
 * records that character as the corp's reader. Signing in an *already added*
 * character is the normal path — it simply widens that character's token. The
 * corp is read once immediately so a missing Director role surfaces here,
 * while the user is still looking at the dialog, rather than silently an hour
 * later.
 */
export async function addBlueprintCorp(): Promise<void> {
  const character = await startLogin([SCOPE_READ_CORP_BLUEPRINTS]);

  if (!hasGrantedScope(character.id, SCOPE_READ_CORP_BLUEPRINTS)) {
    throw new UserFacingError(
      `${character.name} did not grant ${SCOPE_READ_CORP_BLUEPRINTS}, so MCO cannot read a corporation hangar with it.`,
    );
  }

  const pub = await getCharacterPublic(character.id);
  upsertCharacter({
    id: character.id,
    name: pub.name,
    corpId: pub.corporation_id,
    allianceId: pub.alliance_id ?? null,
  });

  if (pub.corporation_id < MIN_PLAYER_CORP_ID) {
    throw new UserFacingError(
      `${character.name} is in an NPC corporation, which has no blueprint hangar. Sign in with a character in your alt corp.`,
    );
  }

  let name: string | null = null;
  let ticker: string | null = null;
  try {
    const corp = await getCorporationPublic(pub.corporation_id);
    name = corp.name;
    ticker = corp.ticker;
  } catch (err) {
    // Cosmetic only — the hangar reads fine without a resolved name.
    console.warn(`Could not resolve corporation ${pub.corporation_id}:`, err);
  }

  upsertBlueprintCorp({
    corporationId: pub.corporation_id,
    name,
    ticker,
    readerCharacterId: character.id,
  });

  await syncBlueprintCorps({ force: true });

  // The corp stays tracked either way — a missing Director role is fixed in
  // game and retried with Refresh — but the reason has to reach the user now,
  // not sit on a card behind a collapsed panel.
  const added = listBlueprintCorps().find((c) => c.corporationId === pub.corporation_id);
  if (added?.lastError) throw new UserFacingError(added.lastError);
}

export function removeBlueprintCorporation(corporationId: number): void {
  removeBlueprintCorp(corporationId);
}

/**
 * Build the blueprint checklist: the SDE's blueprint universe with every
 * original held by a character or a tracked alt corp counted against it, plus
 * the coverage strip that says which characters and corps are actually
 * reporting — a checklist quietly missing a third of the fleet is worse than no
 * checklist.
 */
export function buildBlueprintBoard(): BlueprintBoard {
  const catalog = getBlueprintCatalog();
  const characters = listCharacters();
  const characterNames = new Map(characters.map((c) => [c.id, c.name]));
  const corps = listBlueprintCorps();
  const corpNames = new Map(corps.map((c) => [c.corporationId, c.name ?? `Corporation ${c.corporationId}`]));

  const holdings: HoldingInput[] = [
    ...listCharacterBlueprints().map((row) => ({
      itemId: row.itemId,
      typeId: row.typeId,
      quantity: row.quantity,
      materialEfficiency: row.materialEfficiency,
      timeEfficiency: row.timeEfficiency,
      holderKind: 'character' as const,
      holderId: row.characterId,
      holderName: characterNames.get(row.characterId) ?? `Character ${row.characterId}`,
    })),
    ...listCorporationBlueprints().map((row) => ({
      itemId: row.itemId,
      typeId: row.typeId,
      quantity: row.quantity,
      materialEfficiency: row.materialEfficiency,
      timeEfficiency: row.timeEfficiency,
      holderKind: 'corporation' as const,
      holderId: row.corporationId,
      holderName: corpNames.get(row.corporationId) ?? `Corporation ${row.corporationId}`,
    })),
  ];

  const { entries, totals, originalsByHolder } = buildOwnership(catalog, holdings);

  const syncTimes = getCharacterBlueprintSyncTimes();
  const invalid = getInvalidTokenIds();
  const coverage: BlueprintCharacterCoverage[] = characters.map((character) => {
    const missing = missingScopes(grantedScopes(character.id), [SCOPE_READ_BLUEPRINTS]);
    return {
      characterId: character.id,
      characterName: character.name,
      status: classifyEsiDataStatus({
        tokenInvalid: invalid.has(character.id),
        missingScopes: missing,
        hasSynced: syncTimes.has(character.id),
      }),
      missingScopes: missing,
      updatedAt: syncTimes.get(character.id) ?? null,
      originals: originalsByHolder.get(holderKey('character', character.id)) ?? 0,
    };
  });

  const corpStatus: BlueprintCorpStatus[] = corps.map((corp) => ({
    corporationId: corp.corporationId,
    name: corp.name,
    ticker: corp.ticker,
    readerCharacterId: corp.readerCharacterId,
    readerCharacterName: characterNames.get(corp.readerCharacterId) ?? null,
    syncedAt: corp.syncedAt,
    lastError: corp.lastError,
    originals: originalsByHolder.get(holderKey('corporation', corp.corporationId)) ?? 0,
  }));

  return {
    needsBlueprintData: catalog.length === 0,
    entries,
    totals,
    characters: coverage,
    corps: corpStatus,
  };
}
