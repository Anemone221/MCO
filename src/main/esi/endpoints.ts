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
  return esiGet<EsiCharacterPublic>(`/characters/${characterId}/`);
}

export function getCharacterSkills(characterId: number): Promise<EsiSkills> {
  return esiGet<EsiSkills>(`/characters/${characterId}/skills/`, { characterId });
}

export function getCharacterSkillQueue(characterId: number): Promise<EsiSkillQueueItem[]> {
  return esiGet<EsiSkillQueueItem[]>(`/characters/${characterId}/skillqueue/`, { characterId });
}

export function getCharacterLocation(characterId: number): Promise<EsiLocation> {
  return esiGet<EsiLocation>(`/characters/${characterId}/location/`, { characterId });
}

export function getCharacterShip(characterId: number): Promise<EsiShip> {
  return esiGet<EsiShip>(`/characters/${characterId}/ship/`, { characterId });
}

/** Returns the implant type ids in the character's active clone. */
export function getCharacterImplants(characterId: number): Promise<number[]> {
  return esiGet<number[]>(`/characters/${characterId}/implants/`, { characterId });
}
