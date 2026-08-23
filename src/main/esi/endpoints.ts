import { esiGet, esiGetPaged } from './client';
import type { PagingOptions } from './paging';

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
  /** Tax withheld at source — a taxed bounty's `amount` is already net of this. */
  tax?: number;
  /** Sender; for a taxed payout, absent unless there was a counterparty. */
  first_party_id?: number;
  /** Receiver. */
  second_party_id?: number;
  date: string;
}

/**
 * A character's wallet journal, newest first, 1000 entries to a page. Requires
 * esi-wallet.read_character_wallet.v1 (same scope as /wallet itself).
 *
 * The paging bounds are the caller's: how far back the journal is worth reading
 * is a question about what the data is for, not about the endpoint.
 */
export function getCharacterWalletJournal(
  characterId: number,
  paging: PagingOptions<EsiWalletJournalEntry> = {},
): Promise<EsiWalletJournalEntry[]> {
  return esiGetPaged<EsiWalletJournalEntry>(`/characters/${characterId}/wallet/journal`, {
    characterId,
    ...paging,
  });
}

export interface EsiBlueprint {
  /** Unique id of this specific blueprint item. */
  item_id: number;
  type_id: number;
  location_id: number;
  location_flag: string;
  /**
   * -1 for a **blueprint original**, -2 for a copy; a positive number is a
   * stack of copies. This is the only field that distinguishes a BPO from a BPC.
   */
  quantity: number;
  /** Runs left on a copy; -1 for an original (unlimited). */
  runs: number;
  material_efficiency: number;
  time_efficiency: number;
}

/**
 * Ceiling on blueprint pages read at once — a guard against a hangar of
 * unexpected size turning one sync into thousands of requests, not a stopping
 * rule (`X-Pages` is that). ESI serves blueprints 1000 to a page, so this is
 * 50k blueprints for one holder.
 */
const BLUEPRINT_MAX_PAGES = 50;

/**
 * Every blueprint in a character's own hangars.
 * Requires esi-characters.read_blueprints.v1.
 */
export function getCharacterBlueprints(characterId: number): Promise<EsiBlueprint[]> {
  return esiGetPaged<EsiBlueprint>(`/characters/${characterId}/blueprints`, {
    characterId,
    maxPages: BLUEPRINT_MAX_PAGES,
  });
}

/**
 * Every blueprint in a corporation's hangars, read through a member's token.
 * Requires esi-corporations.read_blueprints.v1 **and** the Director role on
 * that character — ESI answers 403 otherwise.
 */
export function getCorporationBlueprints(
  corporationId: number,
  characterId: number,
): Promise<EsiBlueprint[]> {
  return esiGetPaged<EsiBlueprint>(`/corporations/${corporationId}/blueprints`, {
    characterId,
    maxPages: BLUEPRINT_MAX_PAGES,
  });
}

export interface EsiCorporationPublic {
  name: string;
  ticker: string;
  member_count: number;
  ceo_id: number;
}

/** Public corporation info (name + ticker) — no authorization required. */
export function getCorporationPublic(corporationId: number): Promise<EsiCorporationPublic> {
  return esiGet<EsiCorporationPublic>(`/corporations/${corporationId}`);
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

export interface EsiMiningEntry {
  /** UTC calendar day, YYYY-MM-DD — ESI aggregates the ledger per day. */
  date: string;
  /** Units mined that day, in that system, of that type. */
  quantity: number;
  solar_system_id: number;
  type_id: number;
}

/**
 * Ceiling on mining-ledger pages read at once. ESI serves 1000 rows to a page
 * and a row is one (day, system, type) bucket, so even a character mining a
 * dozen ore types across a dozen systems every day for the ledger's whole
 * 30-day reach stays inside one page — this is the guard, not the stopping
 * rule (`X-Pages` is that).
 */
const MINING_LEDGER_MAX_PAGES = 5;

/**
 * A character's mining ledger — the last ~30 days, already aggregated by day,
 * solar system and ore type. Requires esi-industry.read_character_mining.v1.
 *
 * Unlike the wallet journal there is no "far enough back" to stop at: the
 * endpoint's own window is the limit, and every page of it is worth banking
 * (MCO's history reaches further back than ESI's does).
 */
export function getCharacterMiningLedger(characterId: number): Promise<EsiMiningEntry[]> {
  return esiGetPaged<EsiMiningEntry>(`/characters/${characterId}/mining`, {
    characterId,
    maxPages: MINING_LEDGER_MAX_PAGES,
  });
}
