import type {
  CharacterSummary,
  RosterEntry,
  SkillQueueEntry,
  SyncResult,
  TrainingStatus,
} from '@shared/types';
import { ESI_BASE_URL } from '../config';
import {
  getCharacterLocation,
  getCharacterPublic,
  getCharacterShip,
  getCharacterSkillQueue,
  getCharacterSkills,
} from '../esi/endpoints';
import {
  getCharacter,
  listCharacters,
  touchRefreshed,
  upsertCharacter,
} from '../db/repositories/characters';
import { listAccounts } from '../db/repositories/accounts';
import { upsertCharacterLocation } from '../db/repositories/characterLocation';
import { getCached, isFresh } from '../db/repositories/esiCache';
import { getQueue, getTotalSp, replaceQueue, replaceSkills } from '../db/repositories/skills';
import { getTypeNames } from '../db/repositories/sde';

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
  } catch (err) {
    console.warn(`Location sync failed for character ${characterId}:`, err);
  }

  touchRefreshed(characterId);
}

/** Sync a list of characters; failures are captured per-character, not aborting the batch. */
async function syncCharacterList(characters: CharacterSummary[]): Promise<SyncResult[]> {
  const settled = await Promise.allSettled(
    characters.map(async (c) => {
      await syncCharacter(c.id);
      return c.id;
    }),
  );
  return settled.map((outcome, index) => {
    const characterId = characters[index]!.id;
    if (outcome.status === 'fulfilled') return { characterId, ok: true };
    return { characterId, ok: false, error: String(outcome.reason) };
  });
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
  const skillsUrl = `${ESI_BASE_URL}/characters/${characterId}/skills/`;
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

/** Build the roster view: every character with account label, total SP and training status. */
export function buildRoster(): RosterEntry[] {
  const accounts = new Map(listAccounts().map((a) => [a.id, a.label]));
  return listCharacters().map((character) => ({
    character,
    accountLabel: character.accountId !== null ? (accounts.get(character.accountId) ?? null) : null,
    totalSp: getTotalSp(character.id),
    training: getTrainingStatus(character.id),
  }));
}

export function requireCharacter(characterId: number): void {
  if (!getCharacter(characterId)) {
    throw new Error(`Unknown character ${characterId}`);
  }
}
