import type {
  CharacterSummary,
  RosterEntry,
  SkillQueueEntry,
  SyncResult,
  TrainingStatus,
} from '@shared/types';
import {
  ESI_BASE_URL,
  SCOPE_READ_BLUEPRINTS,
  SCOPE_READ_CLONES,
  SCOPE_READ_FATIGUE,
  SCOPE_READ_IMPLANTS,
  SCOPE_READ_MINING,
  SCOPE_READ_ONLINE,
  SCOPE_READ_WALLET,
} from '../config';
import { grantedScopes } from '../auth/token-store';
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
  getCharacterMiningLedger,
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
import { isTrackedRefType, upsertJournalEntries } from '../db/repositories/characterWalletJournal';
import { upsertMiningEntries } from '../db/repositories/characterMining';
import { getCached, isFresh } from '../db/repositories/esiCache';
import {
  getActiveSkillLevels,
  getQueue,
  getTotalSp,
  replaceQueue,
  replaceSkills,
  type QueueRow,
} from '../db/repositories/skills';
import { getSystems, getTypeNames } from '../db/repositories/sde';
import { pendingQueue } from '../skills/queue';
import { resolveStructures } from './structureService';
import { syncCharacterBlueprints } from './blueprintService';

/**
 * What a sync task can see while it runs. `noteStructure` collects the
 * player-owned structure ids a task came across; the driver resolves them all
 * once at the end of the sync using this character's token, rather than each
 * task resolving its own.
 */
interface SyncContext {
  characterId: number;
  noteStructure: (structureId: number | null | undefined) => void;
}

/**
 * One data domain pulled per character.
 *
 * Every domain is the same stanza — optional scope gate, fetch, map, store,
 * warn-don't-throw — so the gate, the try/catch, the failure line and the
 * ordering belong to the driver ({@link syncCharacter}) and a new domain
 * (assets, contracts, industry jobs, LP balances) is one more entry in
 * {@link SYNC_TASKS} instead of one more copy of the stanza.
 */
interface SyncTask {
  /** Subject of the failure line: `<name> sync failed for character <id>`. */
  name: string;
  /**
   * ESI scope this data needs; omitted when the base scopes every token
   * carries already cover it. Tokens issued before a scope was added to
   * ESI_SCOPES don't have it — the driver skips those tasks calmly instead of
   * firing requests ESI would reject, and the page concerned shows a
   * "scope required" state until the character is re-added.
   */
  scope?: string;
  /**
   * Data the app can't be useful without: a failure aborts the whole sync, so
   * the character is left un-refreshed and the next sweep retries it.
   * Everything else is best-effort — one unreachable wallet endpoint must not
   * cost the roster its skills.
   */
  critical?: boolean;
  run: (ctx: SyncContext) => Promise<void>;
}

/**
 * The per-character sync, in execution order. Sequential by design: the ESI
 * client paces and caps requests globally and the sweep already runs a wave of
 * characters at once, so fanning one character's domains out as well would
 * only deepen the burst `syncCharacterList` exists to flatten.
 */
const SYNC_TASKS: SyncTask[] = [
  {
    name: 'Skills',
    critical: true,
    async run({ characterId }) {
      const [pub, skills, queue] = await Promise.all([
        getCharacterPublic(characterId),
        getCharacterSkills(characterId),
        getCharacterSkillQueue(characterId),
      ]);

      // Stored only once all three have landed: a half-read sync writes
      // nothing rather than a fresh queue against last hour's skills.
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
    },
  },
  {
    name: 'Location',
    async run({ characterId, noteStructure }) {
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
      noteStructure(location.structure_id);
    },
  },
  {
    name: 'Implant',
    scope: SCOPE_READ_IMPLANTS,
    async run({ characterId }) {
      replaceActiveImplants(characterId, await getCharacterImplants(characterId));
    },
  },
  {
    name: 'Clone',
    scope: SCOPE_READ_CLONES,
    async run({ characterId, noteStructure }) {
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
        if (c.location_type === 'structure') noteStructure(c.location_id);
      }
      if (clones.home_location?.location_type === 'structure') {
        noteStructure(clones.home_location.location_id);
      }
    },
  },
  {
    name: 'Fatigue',
    scope: SCOPE_READ_FATIGUE,
    async run({ characterId }) {
      const fatigue = await getCharacterFatigue(characterId);
      upsertCharacterFatigue({
        characterId,
        jumpFatigueExpireDate: fatigue.jump_fatigue_expire_date ?? null,
        lastJumpDate: fatigue.last_jump_date ?? null,
      });
    },
  },
  {
    name: 'Wallet',
    scope: SCOPE_READ_WALLET,
    async run({ characterId }) {
      upsertCharacterWallet(characterId, await getCharacterWallet(characterId));
    },
  },
  {
    // Same scope as the balance, but its own task: a journal that fails to
    // page must not cost the board the balance it already read.
    name: 'Wallet journal',
    scope: SCOPE_READ_WALLET,
    run: ({ characterId }) => syncWalletJournal(characterId),
  },
  {
    name: 'Mining ledger',
    scope: SCOPE_READ_MINING,
    run: ({ characterId }) => syncMiningLedger(characterId),
  },
  {
    // Only a character's *own* hangars — an alt corp's blueprints are read
    // once per corp through its designated reader (services/blueprintService.ts).
    name: 'Blueprint',
    scope: SCOPE_READ_BLUEPRINTS,
    run: ({ characterId }) => syncCharacterBlueprints(characterId),
  },
  {
    name: 'Online-status',
    scope: SCOPE_READ_ONLINE,
    async run({ characterId }) {
      const online = await getCharacterOnline(characterId);
      upsertCharacterOnline(
        characterId,
        online.online,
        online.last_login ?? null,
        online.last_logout ?? null,
      );
    },
  },
  {
    // Neural attributes ride the base skills scope every token has.
    name: 'Attribute',
    async run({ characterId }) {
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
    },
  },
];

/** Pull one character's ESI data into the DB, one {@link SYNC_TASKS} entry at a time. */
export async function syncCharacter(characterId: number): Promise<void> {
  // Player-owned structures the tasks reference, resolved into the shared
  // structures table once the sync's requests are done.
  const structureIds: number[] = [];
  const ctx: SyncContext = {
    characterId,
    noteStructure: (structureId) => {
      if (structureId != null) structureIds.push(structureId);
    },
  };

  // Read on first use, then reused: the critical task ahead of every gated one
  // refreshes the access token, and `grantedScopes` reads that token's claim.
  // A grant can only widen through a fresh login, which rewrites the row
  // outright, so one read per sync sees the same answer as nine would.
  let granted: Set<string> | null = null;
  const hasScope = (scope: string): boolean =>
    (granted ??= new Set(grantedScopes(characterId))).has(scope);

  for (const task of SYNC_TASKS) {
    if (task.scope !== undefined && !hasScope(task.scope)) continue;
    if (task.critical) {
      await task.run(ctx);
      continue;
    }
    try {
      await task.run(ctx);
    } catch (err) {
      console.warn(`${task.name} sync failed for character ${characterId}:`, err);
    }
  }

  // Scope-gated, throttled and deduped inside the service; never throws.
  await resolveStructures(characterId, structureIds);

  touchRefreshed(characterId);
}

/** How far back the journal is read: 31-day months plus margin, comfortably covering "this month". */
const WALLET_JOURNAL_LOOKBACK_MS = 35 * 24 * 60 * 60 * 1000;
/** Hard cap on pages fetched per sync, so a character with heavy wallet traffic can't flood a sweep. */
const WALLET_JOURNAL_MAX_PAGES = 10;

/**
 * Read a character's recent wallet journal and store only the ref_types the
 * Wallet page tracks (income, corp reward payouts, tax, player donations).
 *
 * The journal is newest-first, and this only has to cover the current calendar
 * month rather than full history — so paging stops at the page whose oldest
 * entry predates the lookback window (or at the page cap, whichever comes
 * first). Everything else about paging belongs to `esiGetPaged`.
 *
 * Months roll off ESI (its journal reaches ~30 days back) but not out of the
 * table: the previous-months view is built from what these sweeps banked, so
 * history starts at the first sync rather than at the character's first kill.
 */
async function syncWalletJournal(characterId: number): Promise<void> {
  const cutoff = Date.now() - WALLET_JOURNAL_LOOKBACK_MS;
  const entries = await getCharacterWalletJournal(characterId, {
    maxPages: WALLET_JOURNAL_MAX_PAGES,
    stopAfter: (page) => {
      const oldest = page[page.length - 1];
      return oldest !== undefined && new Date(oldest.date).getTime() < cutoff;
    },
  });

  const tracked = entries.filter(
    (e): e is typeof e & { amount: number } =>
      e.amount !== undefined && isTrackedRefType(e.ref_type),
  );
  if (tracked.length === 0) return;

  upsertJournalEntries(
    characterId,
    tracked.map((e) => ({
      journalId: e.id,
      refType: e.ref_type,
      amount: e.amount,
      tax: e.tax ?? 0,
      firstPartyId: e.first_party_id ?? null,
      secondPartyId: e.second_party_id ?? null,
      occurredAt: e.date,
    })),
  );
}

/**
 * Read a character's mining ledger and bank every row of it.
 *
 * ESI already aggregates the ledger per (day, solar system, ore type) and only
 * reaches ~30 days back, so there is nothing to filter and no "far enough
 * back" to stop at — the whole response is the last month of mining, and the
 * upsert refreshes today's still-growing buckets in place. Rows stay in the
 * table once they age out of ESI's window, which is what lets the Mining page
 * look further back than ESI can.
 */
async function syncMiningLedger(characterId: number): Promise<void> {
  const entries = await getCharacterMiningLedger(characterId);
  upsertMiningEntries(
    characterId,
    entries.map((e) => ({
      day: e.date,
      solarSystemId: e.solar_system_id,
      typeId: e.type_id,
      quantity: e.quantity,
    })),
  );
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
  return trainingStatusFromQueue(pendingQueue(getQueue(characterId)));
}

/**
 * Same as {@link getTrainingStatus} for a queue the caller already loaded.
 * Expects a {@link pendingQueue} — finished entries must already be gone, or
 * the head is a completed skill and the character reads as idle. A head with no
 * finish date means the queue is paused: skills are lined up, none is training.
 */
function trainingStatusFromQueue(queue: QueueRow[]): TrainingStatus {
  const head = queue[0];
  if (!head || !head.finishDate) {
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

/** Still-to-train skill queue for a character with SDE-resolved skill names. */
export function getSkillQueue(characterId: number): SkillQueueEntry[] {
  const queue = pendingQueue(getQueue(characterId));
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
 * and skill-queue status, and its last-known location system and ship
 * (name-resolved via the SDE).
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
    // One queue read feeds both the training status and the queue totals.
    const queue = pendingQueue(getQueue(character.id));
    return {
      character,
      accountLabel:
        character.accountId !== null ? (accounts.get(character.accountId) ?? null) : null,
      totalSp: getTotalSp(character.id),
      training: trainingStatusFromQueue(queue),
      queueLength: queue.length,
      queueEndDate: queue.length > 0 ? (queue[queue.length - 1]!.finishDate ?? null) : null,
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
