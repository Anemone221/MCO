import type {
  CharacterSummary,
  RosterEntry,
  SkillQueueEntry,
  SyncResult,
  TrainingStatus,
} from '@shared/types';
import {
  ESI_BASE_URL,
  SCOPE_READ_CLONES,
  SCOPE_READ_FATIGUE,
  SCOPE_READ_IMPLANTS,
  SCOPE_READ_ONLINE,
  SCOPE_READ_WALLET,
} from '../config';
import { hasGrantedScope } from '../auth/token-store';
import { recordEvent } from '../esi/esiLog';
import {
  getCharacterAttributes,
  getCharacterClones,
  getCharacterFatigue,
  getCharacterImplants,
  getCharacterLocation,
  getCharacterOnline,
  getCharacterPublic,
  getCharacterShip,
  getCharacterSkillQueue,
  getCharacterSkills,
  getCharacterWallet,
  getCharacterWalletJournal,
} from '../esi/endpoints';
import {
  getAllCloneMeta,
  replaceActiveImplants,
  replaceJumpClones,
} from '../db/repositories/clones';
import { INFOMORPH_SYNCHRONIZING_TYPE_ID, nextCloneJumpDate } from '../clones/jumpCooldown';
import {
  getCharacter,
  listCharacters,
  touchRefreshed,
  upsertCharacter,
} from '../db/repositories/characters';
import { listAccounts } from '../db/repositories/accounts';
import {
  listCharacterLocations,
  upsertCharacterLocation,
} from '../db/repositories/characterLocation';
import {
  listCharacterFatigue,
  upsertCharacterFatigue,
} from '../db/repositories/characterFatigue';
import { upsertCharacterAttributes } from '../db/repositories/characterAttributes';
import { listCharacterWallets, upsertCharacterWallet } from '../db/repositories/characterWallet';
import { upsertCharacterOnline } from '../db/repositories/characterOnline';
import { TRACKED_REF_TYPES, upsertJournalEntries } from '../db/repositories/characterWalletJournal';
import { getCached, isFresh } from '../db/repositories/esiCache';
import {
  getActiveSkillLevels,
  getQueue,
  getTotalSp,
  replaceQueue,
  replaceSkills,
} from '../db/repositories/skills';
import { getSystems, getTypeNames } from '../db/repositories/sde';
import { resolveStructures } from './structureService';

/** Pull public info, skills and skill queue for one character from ESI into the DB. */
export async function syncCharacter(characterId: number): Promise<void> {
  const [pub, skills, queue] = await Promise.all([
    getCharacterPublic(characterId),
    getCharacterSkills(characterId),
    getCharacterSkillQueue(characterId),
  ]);

  upsertCharacter({
    id: characterId,
    name: pub.name,
    corpId: pub.corporation_id,
    allianceId: pub.alliance_id ?? null,
  });

  replaceSkills(
    characterId,
    skills.skills.map((s) => ({
      skillTypeId: s.skill_id,
      sp: s.skillpoints_in_skill,
      trainedLevel: s.trained_skill_level,
      activeLevel: s.active_skill_level,
    })),
  );

  replaceQueue(
    characterId,
    queue.map((q) => ({
      position: q.queue_position,
      skillTypeId: q.skill_id,
      finishLevel: q.finished_level,
      startDate: q.start_date ?? null,
      finishDate: q.finish_date ?? null,
    })),
  );

  // Player-owned structures this character references; resolved into the
  // shared structures table at the end of the sync using this token.
  const structureIds: number[] = [];

  // Location and ship are best-effort — a failure here must not fail the sync.
  try {
    const [location, ship] = await Promise.all([
      getCharacterLocation(characterId),
      getCharacterShip(characterId),
    ]);
    upsertCharacterLocation({
      characterId,
      solarSystemId: location.solar_system_id,
      stationId: location.station_id ?? null,
      structureId: location.structure_id ?? null,
      shipTypeId: ship.ship_type_id,
      shipName: ship.ship_name,
    });
    if (location.structure_id !== undefined) structureIds.push(location.structure_id);
  } catch (err) {
    console.warn(`Location sync failed for character ${characterId}:`, err);
  }

  // Implants and jump clones are best-effort and independent. Tokens issued
  // before a scope was added to ESI_SCOPES don't have it — skip those calls
  // calmly instead of firing requests ESI will reject; the clone board shows
  // a "scope required" state until the character is re-added.
  if (hasGrantedScope(characterId, SCOPE_READ_IMPLANTS)) {
    try {
      replaceActiveImplants(characterId, await getCharacterImplants(characterId));
    } catch (err) {
      console.warn(`Implant sync failed for character ${characterId}:`, err);
    }
  }
  if (hasGrantedScope(characterId, SCOPE_READ_CLONES)) {
    try {
      const clones = await getCharacterClones(characterId);
      replaceJumpClones(
        characterId,
        clones.jump_clones.map((c) => ({
          jumpCloneId: c.jump_clone_id,
          name: c.name ?? null,
          locationId: c.location_id,
          locationType: c.location_type,
          implants: c.implants,
        })),
        {
          lastCloneJumpDate: clones.last_clone_jump_date ?? null,
          homeLocationId: clones.home_location?.location_id ?? null,
          homeLocationType: clones.home_location?.location_type ?? null,
        },
      );
      for (const c of clones.jump_clones) {
        if (c.location_type === 'structure') structureIds.push(c.location_id);
      }
      if (
        clones.home_location?.location_type === 'structure' &&
        clones.home_location.location_id !== undefined
      ) {
        structureIds.push(clones.home_location.location_id);
      }
    } catch (err) {
      console.warn(`Clone sync failed for character ${characterId}:`, err);
    }
  }

  // Jump fatigue is best-effort and scope-gated (esi-characters.read_fatigue.v1).
  if (hasGrantedScope(characterId, SCOPE_READ_FATIGUE)) {
    try {
      const fatigue = await getCharacterFatigue(characterId);
      upsertCharacterFatigue({
        characterId,
        jumpFatigueExpireDate: fatigue.jump_fatigue_expire_date ?? null,
        lastJumpDate: fatigue.last_jump_date ?? null,
      });
    } catch (err) {
      console.warn(`Fatigue sync failed for character ${characterId}:`, err);
    }
  }

  // Wallet balance is best-effort and scope-gated (esi-wallet.read_character_wallet.v1).
  if (hasGrantedScope(characterId, SCOPE_READ_WALLET)) {
    try {
      upsertCharacterWallet(characterId, await getCharacterWallet(characterId));
    } catch (err) {
      console.warn(`Wallet sync failed for character ${characterId}:`, err);
    }
    // Same scope covers the wallet journal, pulled for the Dashboard's ratted-ISK tile.
    try {
      await syncWalletJournal(characterId);
    } catch (err) {
      console.warn(`Wallet journal sync failed for character ${characterId}:`, err);
    }
  }

  // Online status is best-effort and scope-gated (esi-location.read_online.v1).
  if (hasGrantedScope(characterId, SCOPE_READ_ONLINE)) {
    try {
      const online = await getCharacterOnline(characterId);
      upsertCharacterOnline(
        characterId,
        online.online,
        online.last_login ?? null,
        online.last_logout ?? null,
      );
    } catch (err) {
      console.warn(`Online-status sync failed for character ${characterId}:`, err);
    }
  }

  // Neural attributes are best-effort; covered by the base skills scope every
  // token has, so no scope gate is needed.
  try {
    const attributes = await getCharacterAttributes(characterId);
    upsertCharacterAttributes({
      characterId,
      intelligence: attributes.intelligence,
      memory: attributes.memory,
      charisma: attributes.charisma,
      perception: attributes.perception,
      willpower: attributes.willpower,
      bonusRemaps: attributes.bonus_remaps ?? null,
      lastRemapDate: attributes.last_remap_date ?? null,
      accruedRemapCooldownDate: attributes.accrued_remap_cooldown_date ?? null,
    });
  } catch (err) {
    console.warn(`Attribute sync failed for character ${characterId}:`, err);
  }

  // Resolve any player-owned structures seen above (scope-gated, throttled,
  // deduped inside the service; never throws).
  await resolveStructures(characterId, structureIds);

  touchRefreshed(characterId);
}

/** Pagination stop-check safety net: 31-day months plus margin, comfortably covering "this month". */
const WALLET_JOURNAL_LOOKBACK_MS = 35 * 24 * 60 * 60 * 1000;
/** Hard cap on pages fetched per sync, so a character with heavy wallet traffic can't loop forever. */
const WALLET_JOURNAL_MAX_PAGES = 10;
/**
 * A page smaller than this is definitely the journal's last page, so paging
 * stops without probing for a next page. Deliberately below every plausible
 * ESI page size (1000+): a false "last page" would silently drop income rows,
 * while an unnecessary probe merely costs one 404 (see the loop's catch).
 */
const WALLET_JOURNAL_PARTIAL_PAGE = 500;

/**
 * Page through a character's wallet journal (newest-first, per ESI's
 * ordering) storing only the ref_types the Dashboard's ratted-ISK tile
 * tracks. Stops on a clearly-partial page, once a page's oldest entry falls
 * outside the lookback window, or at the hard page cap — this only needs to
 * guarantee coverage of the current calendar month, not full history. ESI
 * answers 404 for a page past the journal's last (there is no empty-page
 * signal), so a failure after the first page ends paging instead of failing
 * the sync — page 1's data is already stored.
 */
async function syncWalletJournal(characterId: number): Promise<void> {
  const cutoff = Date.now() - WALLET_JOURNAL_LOOKBACK_MS;
  for (let page = 1; page <= WALLET_JOURNAL_MAX_PAGES; page += 1) {
    let entries;
    try {
      entries = await getCharacterWalletJournal(characterId, page);
    } catch (err) {
      if (page === 1) throw err;
      break;
    }
    if (entries.length === 0) break;

    const tracked = entries.filter(
      (e): e is typeof e & { amount: number } =>
        e.amount !== undefined && TRACKED_REF_TYPES.includes(e.ref_type),
    );
    if (tracked.length > 0) {
      upsertJournalEntries(
        characterId,
        tracked.map((e) => ({
          journalId: e.id,
          refType: e.ref_type,
          amount: e.amount,
          occurredAt: e.date,
        })),
      );
    }

    if (entries.length < WALLET_JOURNAL_PARTIAL_PAGE) break;
    const oldestOnPage = entries[entries.length - 1]!.date;
    if (new Date(oldestOnPage).getTime() < cutoff) break;
  }
}

/** Characters started per sweep wave. Bounds how many characters' request
 * fan-outs are live at once; the ESI client's pacer/concurrency cap smooths the
 * requests themselves. Small enough that a 90+ fleet de-bursts across the sweep. */
const SWEEP_WAVE_SIZE = 8;
/** Random gap between wave starts, so waves don't line up into a fresh burst. */
const SWEEP_WAVE_JITTER_MS = 400;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Sync a list of characters in small waves. Failures are captured per-character,
 * never aborting the batch. Firing all 90+ characters at once dumped ~1k requests
 * into ESI in a single burst — enough transient errors landing inside one 60 s
 * window to trip the error limit (420) for the whole IP. Waving spreads the fan-out
 * over the sweep so no minute carries the whole error budget; the client's pacer
 * spaces the individual requests.
 */
async function syncCharacterList(characters: CharacterSummary[]): Promise<SyncResult[]> {
  if (characters.length === 0) return [];
  recordEvent({ kind: 'sweep', detail: `start: ${characters.length} character(s)` });
  const results: SyncResult[] = [];
  for (let start = 0; start < characters.length; start += SWEEP_WAVE_SIZE) {
    const wave = characters.slice(start, start + SWEEP_WAVE_SIZE);
    const settled = await Promise.allSettled(
      wave.map(async (c) => {
        await syncCharacter(c.id);
        return c.id;
      }),
    );
    settled.forEach((outcome, index) => {
      const characterId = wave[index]!.id;
      results.push(
        outcome.status === 'fulfilled'
          ? { characterId, ok: true }
          : { characterId, ok: false, error: String(outcome.reason) },
      );
    });
    if (start + SWEEP_WAVE_SIZE < characters.length) {
      await sleep(Math.random() * SWEEP_WAVE_JITTER_MS);
    }
  }
  const failed = results.filter((r) => !r.ok).length;
  recordEvent({ kind: 'sweep', detail: `end: ${results.length - failed}/${results.length} ok` });
  return results;
}

/** Sync every character. */
export function syncAllCharacters(): Promise<SyncResult[]> {
  return syncCharacterList(listCharacters());
}

/**
 * A character is "due" once its cached skills data has expired. ESI sets the
 * cache window via the Expires header, so this tracks each character's own
 * per-endpoint cache window rather than a fixed clock.
 */
export function isCharacterDue(characterId: number): boolean {
  const skillsUrl = `${ESI_BASE_URL}/characters/${characterId}/skills`;
  return !isFresh(getCached(skillsUrl));
}

/** Sync only the characters whose ESI cache window has elapsed. */
export function syncDueCharacters(): Promise<SyncResult[]> {
  return syncCharacterList(listCharacters().filter((c) => isCharacterDue(c.id)));
}

/** Derive the currently-training skill from a character's stored skill queue. */
export function getTrainingStatus(characterId: number): TrainingStatus {
  const queue = getQueue(characterId);
  const head = queue[0];
  if (!head || !head.finishDate || new Date(head.finishDate).getTime() <= Date.now()) {
    return {
      isTraining: false,
      currentSkillTypeId: null,
      currentSkillName: null,
      currentFinishLevel: null,
      finishDate: null,
    };
  }
  const name = getTypeNames([head.skillTypeId]).get(head.skillTypeId) ?? null;
  return {
    isTraining: true,
    currentSkillTypeId: head.skillTypeId,
    currentSkillName: name,
    currentFinishLevel: head.finishLevel,
    finishDate: head.finishDate,
  };
}

/** Full skill queue for a character with SDE-resolved skill names. */
export function getSkillQueue(characterId: number): SkillQueueEntry[] {
  const queue = getQueue(characterId);
  const names = getTypeNames(queue.map((q) => q.skillTypeId));
  return queue.map((q) => ({
    position: q.position,
    skillTypeId: q.skillTypeId,
    skillName: names.get(q.skillTypeId) ?? null,
    finishLevel: q.finishLevel,
    startDate: q.startDate,
    finishDate: q.finishDate,
  }));
}

/**
 * Build the roster view: every character with account label, total SP, training
 * status, and its last-known location system and ship (name-resolved via the SDE).
 */
export function buildRoster(): RosterEntry[] {
  const accounts = new Map(listAccounts().map((a) => [a.id, a.label]));
  const locations = new Map(listCharacterLocations().map((l) => [l.characterId, l]));
  const fatigue = new Map(listCharacterFatigue().map((f) => [f.characterId, f]));
  const wallets = new Map(listCharacterWallets().map((w) => [w.characterId, w.balance]));
  const cloneMeta = getAllCloneMeta();
  const infomorphLevels = getActiveSkillLevels(INFOMORPH_SYNCHRONIZING_TYPE_ID);
  const values = [...locations.values()];
  const systems = getSystems(distinct(values.map((l) => l.solarSystemId)));
  const shipNames = getTypeNames(distinct(values.map((l) => l.shipTypeId)));

  return listCharacters().map((character) => {
    const loc = locations.get(character.id);
    const system = loc?.solarSystemId != null ? systems.get(loc.solarSystemId) : undefined;
    const fat = fatigue.get(character.id);
    const clones = cloneMeta.get(character.id);
    return {
      character,
      accountLabel:
        character.accountId !== null ? (accounts.get(character.accountId) ?? null) : null,
      totalSp: getTotalSp(character.id),
      training: getTrainingStatus(character.id),
      systemName: system?.name ?? null,
      shipTypeName: loc?.shipTypeId != null ? (shipNames.get(loc.shipTypeId) ?? null) : null,
      jumpFatigue: fat ? { expireDate: fat.jumpFatigueExpireDate } : null,
      cloneJump: clones
        ? {
            nextJumpAt: nextCloneJumpDate(
              clones.lastCloneJumpDate,
              infomorphLevels.get(character.id) ?? 0,
            ),
          }
        : null,
      walletBalance: wallets.get(character.id) ?? null,
    };
  });
}

/** Unique, non-null ids from a list — for batching SDE name lookups. */
function distinct(ids: Array<number | null>): number[] {
  return [...new Set(ids.filter((id): id is number => id !== null))];
}

export function requireCharacter(characterId: number): void {
  if (!getCharacter(characterId)) {
    throw new Error(`Unknown character ${characterId}`);
  }
}
