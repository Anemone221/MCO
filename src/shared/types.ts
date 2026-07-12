export interface CharacterSummary {
  id: number;
  name: string;
  corpId: number | null;
  allianceId: number | null;
  accountId: number | null;
  addedAt: string;
  refreshedAt: string | null;
}

export interface AccountBucket {
  id: number;
  label: string;
  color: string | null;
}

export interface SkillQueueEntry {
  position: number;
  skillTypeId: number;
  skillName: string | null;
  finishLevel: number;
  startDate: string | null;
  finishDate: string | null;
}

export interface TrainingStatus {
  isTraining: boolean;
  currentSkillTypeId: number | null;
  currentSkillName: string | null;
  currentFinishLevel: number | null;
  finishDate: string | null;
}

export interface RosterEntry {
  character: CharacterSummary;
  accountLabel: string | null;
  totalSp: number;
  training: TrainingStatus;
}

export interface ImplantInfo {
  typeId: number;
  typeName: string | null;
}

export interface CharacterDetail {
  character: CharacterSummary;
  totalSp: number;
  skillQueue: SkillQueueEntry[];
  location: { solarSystemId: number; solarSystemName: string | null } | null;
  ship: { typeId: number; typeName: string | null; name: string } | null;
  implants: ImplantInfo[];
}

export interface SdeStatus {
  installed: boolean;
  version: string | null;
  importedAt: string | null;
  /** True once skill-requirement data (typeDogma) has been imported. */
  hasSkillData: boolean;
  /** True once map data (solar systems / regions) has been imported. */
  hasMapData: boolean;
}

export interface SdeProgress {
  stage:
    | 'downloading'
    | 'categories'
    | 'groups'
    | 'types'
    | 'dogma'
    | 'maps'
    | 'finalizing'
    | 'done'
    | 'error';
  receivedBytes?: number;
  totalBytes?: number;
  typesProcessed?: number;
  message?: string;
}

export interface LocationEntry {
  characterId: number;
  characterName: string;
  accountLabel: string | null;
  systemId: number | null;
  systemName: string | null;
  security: number | null;
  regionId: number | null;
  regionName: string | null;
  docked: boolean;
  shipName: string | null;
  shipTypeName: string | null;
  updatedAt: string | null;
}

export interface SyncResult {
  characterId: number;
  ok: boolean;
  error?: string;
}

export interface Fit {
  id: number;
  name: string;
  shipTypeId: number | null;
  shipName: string;
  eftText: string;
  importedAt: string;
}

export interface FitItemResolved {
  name: string;
  typeId: number | null;
  quantity: number;
  /** Whether this item is included in the skill-requirement check. */
  counted: boolean;
}

export interface MissingSkill {
  skillTypeId: number;
  skillName: string | null;
  haveLevel: number;
  needLevel: number;
  spDelta: number;
}

export interface FitCharacterResult {
  characterId: number;
  characterName: string;
  canFly: boolean;
  spGap: number;
  missingSkills: MissingSkill[];
}

export interface FitAnalysis {
  fit: Fit;
  shipResolved: boolean;
  items: FitItemResolved[];
  unresolved: string[];
  /** Set when skill-requirement data has not been imported yet. */
  needsSkillData: boolean;
  characters: FitCharacterResult[];
}
