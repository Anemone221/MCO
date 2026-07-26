import { esiGet } from './client';

export interface EsiCharacterPublic {
  name: string;
  corporation_id: number;
  alliance_id?: number;
  birthday: string;
}

export interface EsiSkill {
  skill_id: number;
  skillpoints_in_skill: number;
  trained_skill_level: number;
  active_skill_level: number;
}

export interface EsiSkills {
  total_sp: number;
  unallocated_sp?: number;
  skills: EsiSkill[];
}

export interface EsiSkillQueueItem {
  skill_id: number;
  queue_position: number;
  finished_level: number;
  start_date?: string;
  finish_date?: string;
}

export interface EsiLocation {
  solar_system_id: number;
  station_id?: number;
  structure_id?: number;
}

export interface EsiShip {
  ship_type_id: number;
  ship_name: string;
  ship_item_id: number;
}

/** Public character info — no authorization required. */
export function getCharacterPublic(characterId: number): Promise<EsiCharacterPublic> {
  return esiGet<EsiCharacterPublic>(`/characters/${characterId}`);
}

export function getCharacterSkills(characterId: number): Promise<EsiSkills> {
  return esiGet<EsiSkills>(`/characters/${characterId}/skills`, { characterId });
}

export function getCharacterSkillQueue(characterId: number): Promise<EsiSkillQueueItem[]> {
  return esiGet<EsiSkillQueueItem[]>(`/characters/${characterId}/skillqueue`, { characterId });
}

export interface EsiAttributes {
  intelligence: number;
  memory: number;
  charisma: number;
  perception: number;
  willpower: number;
  /** Stock of bonus remaps available. */
  bonus_remaps?: number;
  last_remap_date?: string;
  /** When the accrued (yearly) remap becomes available. */
  accrued_remap_cooldown_date?: string;
}

/** Neural attributes + remap availability. Covered by esi-skills.read_skills.v1. */
export function getCharacterAttributes(characterId: number): Promise<EsiAttributes> {
  return esiGet<EsiAttributes>(`/characters/${characterId}/attributes`, { characterId });
}

export function getCharacterLocation(characterId: number): Promise<EsiLocation> {
  return esiGet<EsiLocation>(`/characters/${characterId}/location`, { characterId });
}

export function getCharacterShip(characterId: number): Promise<EsiShip> {
  return esiGet<EsiShip>(`/characters/${characterId}/ship`, { characterId });
}

/** Returns the implant type ids in the character's active clone. */
export function getCharacterImplants(characterId: number): Promise<number[]> {
  return esiGet<number[]>(`/characters/${characterId}/implants`, { characterId });
}

export interface EsiFatigue {
  /** When accumulated jump fatigue fully clears. Absent if never fatigued. */
  jump_fatigue_expire_date?: string;
  last_jump_date?: string;
  last_update_date?: string;
}

/** Jump-drive fatigue timers. Requires esi-characters.read_fatigue.v1. */
export function getCharacterFatigue(characterId: number): Promise<EsiFatigue> {
  return esiGet<EsiFatigue>(`/characters/${characterId}/fatigue`, { characterId });
}

export interface EsiJumpClone {
  jump_clone_id: number;
  location_id: number;
  location_type: 'station' | 'structure';
  implants: number[];
  name?: string;
}

export interface EsiClones {
  home_location?: { location_id?: number; location_type?: 'station' | 'structure' };
  jump_clones: EsiJumpClone[];
  last_clone_jump_date?: string;
}

/** Jump clones (with implants and locations). Requires esi-clones.read_clones.v1. */
export function getCharacterClones(characterId: number): Promise<EsiClones> {
  return esiGet<EsiClones>(`/characters/${characterId}/clones`, { characterId });
}

/** Wallet balance in ISK. Requires esi-wallet.read_character_wallet.v1. */
export function getCharacterWallet(characterId: number): Promise<number> {
  return esiGet<number>(`/characters/${characterId}/wallet`, { characterId });
}

export interface EsiOnlineStatus {
  online: boolean;
  last_login?: string;
  last_logout?: string;
  logins?: number;
}

/** Whether a character is currently logged into Tranquility. Requires esi-location.read_online.v1. */
export function getCharacterOnline(characterId: number): Promise<EsiOnlineStatus> {
  return esiGet<EsiOnlineStatus>(`/characters/${characterId}/online`, { characterId });
}

export interface EsiWalletJournalEntry {
  id: number;
  ref_type: string;
  /** Absent for a handful of zero-value ref_types; the ones we track always carry it. */
  amount?: number;
  date: string;
}

/**
 * One page (up to 1000 entries, newest first) of a character's wallet
 * journal. Requires esi-wallet.read_character_wallet.v1 (same scope as
 * /wallet itself).
 */
export function getCharacterWalletJournal(
  characterId: number,
  page: number,
): Promise<EsiWalletJournalEntry[]> {
  return esiGet<EsiWalletJournalEntry[]>(
    `/characters/${characterId}/wallet/journal?page=${page}`,
    { characterId },
  );
}

export interface EsiServerStatus {
  players: number;
  server_version: string;
  start_time: string;
  vip?: boolean;
}

/** Public Tranquility server status (uptime + player count) — no authorization required. */
export function getServerStatus(): Promise<EsiServerStatus> {
  return esiGet<EsiServerStatus>('/status/');
}

export interface EsiStation {
  name: string;
  system_id: number;
}

/** Public NPC-station info — no authorization required. */
export function getStation(stationId: number): Promise<EsiStation> {
  return esiGet<EsiStation>(`/universe/stations/${stationId}`);
}

/**
 * Ids of every structure with public docking (or a public service) — the ones
 * any authed character can resolve. No authorization required; cached 1h.
 */
export function getPublicStructureIds(): Promise<number[]> {
  return esiGet<number[]>('/universe/structures');
}

export interface EsiStructure {
  name: string;
  owner_id: number;
  solar_system_id: number;
  type_id?: number;
}

/**
 * Player-owned (Upwell) structure info. Requires esi-universe.read_structures.v1
 * AND the character must have docking access — ESI answers 403 otherwise.
 */
export function getStructure(structureId: number, characterId: number): Promise<EsiStructure> {
  return esiGet<EsiStructure>(`/universe/structures/${structureId}`, { characterId });
}
