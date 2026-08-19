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
  /** User-maintained: whether this account is Omega (an idle Omega wastes training time). */
  isOmega: boolean;
}

export interface CharacterGroup {
  id: number;
  name: string;
  color: string | null;
  /** Character ids that belong to this group. */
  characterIds: number[];
  /** Fit every member should work toward flying, or null when unset. */
  priorityFitId: number | null;
  /** Skill plan every member should work toward, or null when unset. */
  priorityPlanId: number | null;
  /**
   * Station/structure the members' medical clones should be at; members whose
   * medical clone is elsewhere are flagged on the group page. Null when unset.
   */
  homeStationId: number | null;
  homeStationName: string | null;
  /**
   * Whitelist of solar systems where members' pods carrying implants are
   * allowed to sit; pods elsewhere are flagged on the group page. Empty
   * disables the check.
   */
  podSystems: PodSystemEntry[];
}

/** One solar system in a group's pod-location whitelist. */
export interface PodSystemEntry {
  solarSystemId: number;
  /** Denormalized SDE name, so display never needs a lookup. */
  systemName: string;
}

/**
 * A tag is a character capability ("Is able to Cyno", "Is able to Fax"), independent
 * of any group. Group roles are assigned by reusing these tags.
 */
export interface Tag {
  id: number;
  name: string;
  color: string | null;
  /** Character ids that have this capability. */
  characterIds: number[];
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
  /** Entries in the skill queue (including the one currently training). */
  queueLength: number;
  /** Finish date of the last queue entry; null when the queue is empty or paused. */
  queueEndDate: string | null;
  /** Last-known solar system name, or null if never synced / unresolved. */
  systemName: string | null;
  /** Last-known ship type name (what the character is flying), or null. */
  shipTypeName: string | null;
  /**
   * Jump fatigue: `null` when unknown (never synced / scope not granted).
   * When present, `expireDate` is null/past for a character carrying no fatigue.
   */
  jumpFatigue: { expireDate: string | null } | null;
  /**
   * Clone-jump availability: `null` when unknown (never synced / scope not
   * granted). When present, `nextJumpAt` is null/past for a character that can
   * clone-jump right now.
   */
  cloneJump: { nextJumpAt: string | null } | null;
  /** Wallet balance in ISK; null until synced (the wallet scope postdates early tokens). */
  walletBalance: number | null;
}

/**
 * A character's trained SP in one SDE skill group, against what that group can
 * hold. Feeds the character-sheet skill radar, which plots `sp / maxSp` — how
 * complete the character is in each group.
 */
export interface SkillGroupSp {
  /** Skill-group name from the SDE (e.g. "Gunnery", "Spaceship Command"). */
  group: string;
  /** Trained SP in this group. */
  sp: number;
  /**
   * SP this group holds with every published skill in it at level V — the
   * denominator for group completion. 0 when the SDE has no skill ranks yet
   * (`sde_skill_ranks` empty), which the UI reports instead of dividing.
   */
  maxSp: number;
}

export interface ImplantInfo {
  typeId: number;
  typeName: string | null;
}

/** Neural attributes + remap availability (ESI /characters/{id}/attributes). */
export interface CharacterAttributes {
  intelligence: number;
  memory: number;
  charisma: number;
  perception: number;
  willpower: number;
  /** Stock of bonus remaps; null when ESI omits it. */
  bonusRemaps: number | null;
  /** Null if the character has never remapped. */
  lastRemapDate: string | null;
  /** When the accrued (yearly) remap becomes available; null/past = available. */
  accruedRemapCooldownDate: string | null;
}

/** Lightweight group/tag reference shown on the character sheet. */
export interface OrgRef {
  id: number;
  name: string;
  color: string | null;
}

/** One skill plan's completion state for one character. */
export interface CharacterPlanProgress {
  planId: number;
  planName: string;
  complete: boolean;
  /** SP still missing, prerequisites included. */
  spGap: number;
  /** Full SP the plan requires when trained from zero. */
  totalSp: number;
  /** 0..1 share of the plan's SP the character already holds. */
  progress: number;
  /** Whole Large Skill Injectors to close spGap; 0 when complete. */
  lsiGap: number;
  /** Attribute-based minutes to train the gap; null when the data is missing. */
  timeGapMinutes: number | null;
}

export interface CharacterDetail {
  character: CharacterSummary;
  totalSp: number;
  skillQueue: SkillQueueEntry[];
  /** Trained SP per skill group, biggest first — feeds the skill radar. Empty until skills/SDE are present. */
  skillGroups: SkillGroupSp[];
  location: { solarSystemId: number; solarSystemName: string | null } | null;
  ship: { typeId: number; typeName: string | null; name: string } | null;
  implants: ImplantInfo[];
  /**
   * Jump fatigue: `null` when unknown (never synced / scope not granted).
   * When present, `expireDate` is null/past for a character carrying no fatigue.
   */
  jumpFatigue: { expireDate: string | null; lastJumpDate: string | null } | null;
  /** Neural attributes; null until synced. */
  attributes: CharacterAttributes | null;
  /** Wallet balance in ISK; null until synced. */
  wallet: { balance: number; updatedAt: string } | null;
  /** Why the wallet balance may be absent (the wallet scope postdates early tokens). */
  walletStatus: EsiDataStatus;
  clones: JumpCloneEntry[];
  /** Null until clone data has synced. */
  clonesUpdatedAt: string | null;
  /** Medical (home) clone location; null until synced or when ESI omits it. */
  medicalClone: CloneLocation | null;
  /** Last clone jump; null if the character has never clone-jumped. */
  lastCloneJumpAt: string | null;
  /**
   * When the next clone jump is available (24h minus 1h per Infomorph
   * Synchronizing level after the last jump); may be in the past (= available
   * now). Null when the character has never clone-jumped.
   */
  nextCloneJumpAt: string | null;
  groups: OrgRef[];
  tags: OrgRef[];
  plans: CharacterPlanProgress[];
  /** True when plans exist but SDE skill-requirement data isn't imported yet. */
  plansNeedSkillData: boolean;
  /** True when this character is currently training. */
  isTraining: boolean;
  /** Training-slot context from the account bucket; null when unassigned. */
  accountStatus: { isOmega: boolean; otherCharacterTraining: boolean } | null;
}

export interface SdeStatus {
  installed: boolean;
  version: string | null;
  importedAt: string | null;
  /** True once skill-requirement data (typeDogma) has been imported. */
  hasSkillData: boolean;
  /** True once map data (solar systems / regions) has been imported. */
  hasMapData: boolean;
  /** True once per-skill training attributes (dogma 180/181) have been imported. */
  hasSkillAttributes: boolean;
  /** True once blueprints.yaml has been imported — gates the blueprint checklist. */
  hasBlueprintData: boolean;
  /**
   * True once the stargate graph (mapStargates.yaml) has been imported — gates
   * the "nearest character to a system" search on the Location page.
   */
  hasJumpData: boolean;
}

export interface SdeProgress {
  stage:
    | 'downloading'
    | 'categories'
    | 'groups'
    | 'types'
    | 'dogma'
    | 'blueprints'
    | 'maps'
    | 'finalizing'
    | 'done'
    | 'error';
  receivedBytes?: number;
  totalBytes?: number;
  typesProcessed?: number;
  message?: string;
}

/** Progress of a public-structure import: `done` of `total` due ids fetched. */
export interface StructureImportProgress {
  done: number;
  total: number;
}

/** One hit from the home-station structure search. */
export interface StructureSearchResult {
  structureId: number;
  name: string;
  /** Solar system the structure sits in; null when map data isn't imported. */
  systemName: string | null;
}

/** One hit from the solar-system search (pod-whitelist picker). */
export interface SystemSearchResult {
  solarSystemId: number;
  name: string;
  security: number;
  regionName: string | null;
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
  /** Name of the station/structure the character is docked at, when resolved. */
  dockedName: string | null;
  shipName: string | null;
  shipTypeName: string | null;
  updatedAt: string | null;
}

/**
 * One of a character's jump clones, measured against the designated system.
 *
 * A clone is a second position the character can occupy — arriving in a pod,
 * so it only helps where a ship is already stationed — which is why the clones
 * come alongside the character's own distance rather than replacing it.
 */
export interface NearestCloneOption {
  jumpCloneId: number;
  /** Player-assigned clone name, if any. */
  name: string | null;
  /** Station or structure the clone sits in; null while unresolved. */
  locationName: string | null;
  systemId: number;
  systemName: string | null;
  security: number | null;
  regionName: string | null;
  /** Gate jumps from the clone's system to the target; null when no gate route exists. */
  jumps: number | null;
  lightYears: number | null;
}

/**
 * One character measured against a designated system: everything the location
 * board already knows about it, plus how far away it is.
 *
 * The two distances answer different questions and neither substitutes for the
 * other — `jumps` is how long the character takes to *get* there by gates,
 * `lightYears` is whether a capital could jump to it where it stands.
 */
export interface NearestCharacterEntry extends LocationEntry {
  /** Gate jumps to the target system; null when no gate route exists (wormhole space). */
  jumps: number | null;
  /** Straight-line distance in light years; null when either position is unknown. */
  lightYears: number | null;
  /** The character's capability tags, in name order. */
  tagNames: string[];
  /**
   * The character's jump clones, nearest the target first. Empty unless the
   * clone check was asked for (and for characters with no clones, or none whose
   * location resolves to a system).
   */
  clones: NearestCloneOption[];
  /**
   * When this character may clone-jump next — past means ready, null means it
   * has never jumped (also ready), and null is likewise what a board without
   * the clone check reports. Distinguishing "ready" from "in 6 hours" is the
   * difference between a clone being an answer and a plan.
   */
  cloneJumpReadyAt: string | null;
}

/** The answer to "who is nearest to this system", ranked by gate jumps. */
export interface NearestBoard {
  /** The system that was measured against. */
  target: SystemSearchResult;
  /** Every character with a known location, nearest first. */
  entries: NearestCharacterEntry[];
  /** Characters left out because their location has never been synced. */
  unlocatedCount: number;
  /**
   * False when the stargate graph has not been imported, which makes every
   * `jumps` null — the UI says to re-import rather than reporting "no route"
   * for all 90 characters.
   */
  hasJumpData: boolean;
  /** Whether jump clones were measured as well as current locations. */
  includesJumpClones: boolean;
  /**
   * Jump clones that could not be measured because their structure has no
   * resolved system yet (see the structure importer). Counted rather than
   * dropped silently: a clone in an unresolved citadel could be the nearest
   * one there is.
   */
  unmeasuredClones: number;
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
  /** Whole Large Skill Injectors to close spGap (diminishing returns); 0 when capable. */
  lsiGap: number;
  /**
   * Attribute-based minutes to train the gap; 0 when capable. Null when the
   * character's neural attributes haven't synced or any missing skill lacks
   * SDE training-attribute data (pre-v21 import).
   */
  timeGapMinutes: number | null;
  missingSkills: MissingSkill[];
}

export interface FitAnalysis {
  fit: Fit;
  shipResolved: boolean;
  items: FitItemResolved[];
  unresolved: string[];
  /** Set when skill-requirement data has not been imported yet. */
  needsSkillData: boolean;
  /** Set when per-skill training attributes are missing (SDE re-import needed). */
  needsSkillAttributes: boolean;
  characters: FitCharacterResult[];
}

export interface SkillPlan {
  id: number;
  name: string;
  planText: string;
  importedAt: string;
}

export interface PlanSkillResolved {
  skillName: string;
  skillTypeId: number | null;
  level: number;
}

export interface PlanCharacterResult {
  characterId: number;
  characterName: string;
  /** True when the character already meets every skill+level listed in the plan. */
  complete: boolean;
  spGap: number;
  /** Whole Large Skill Injectors to close spGap (diminishing returns); 0 when complete. */
  lsiGap: number;
  /**
   * Attribute-based minutes to train the gap; 0 when complete. Null when the
   * character's neural attributes haven't synced or any missing skill lacks
   * SDE training-attribute data (pre-v21 import).
   */
  timeGapMinutes: number | null;
  missingSkills: MissingSkill[];
}

export interface PlanAnalysis {
  plan: SkillPlan;
  skills: PlanSkillResolved[];
  unresolved: string[];
  /** Set when skill-requirement data has not been imported yet. */
  needsSkillData: boolean;
  /** Set when per-skill training attributes are missing (SDE re-import needed). */
  needsSkillAttributes: boolean;
  characters: PlanCharacterResult[];
}

/** The five neural attributes a skill trains against. */
export type TrainingAttribute =
  | 'charisma'
  | 'intelligence'
  | 'memory'
  | 'perception'
  | 'willpower';

/** The five neural attribute values used for training-speed math. */
export interface NeuralAttributes {
  charisma: number;
  intelligence: number;
  memory: number;
  perception: number;
  willpower: number;
}

/**
 * Everything the plan creator needs about one skill to show it, cost it and
 * order it — supplied by the main process so the draft logic in the renderer
 * needs no SDE access and no copy of the SP formula.
 */
export interface PlanSkillInfo {
  skillTypeId: number;
  name: string;
  /** SDE skill group ("Gunnery", "Spaceship Command") — how the browser groups. */
  groupId: number | null;
  groupName: string | null;
  /** skillTimeConstant; 1 when the SDE has no rank for the skill. */
  rank: number;
  /** Training attributes; null when the SDE lacks attribute data (pre-v21 import). */
  primaryAttribute: TrainingAttribute | null;
  secondaryAttribute: TrainingAttribute | null;
  /** Total SP to hold level 1..5, index 0 = level I. */
  spAtLevel: number[];
  /** This skill's own prerequisites, each at the level needed to train it. */
  prereqs: Array<{ skillTypeId: number; level: number }>;
  /**
   * Unpublished skills are retired ones — kept in the catalogue so a plan that
   * still names one can be shown and costed, but left out of the browser.
   */
  published: boolean;
}

/**
 * A hull as the plan creator's ship browser lists it, with the skills flying it
 * needs. Requirements travel with the catalogue (415 ships, ~700 requirements)
 * so picking a ship costs no round-trip.
 */
export interface ShipInfo {
  shipTypeId: number;
  name: string;
  groupId: number | null;
  groupName: string | null;
  requirements: Array<{ skillTypeId: number; level: number }>;
}

/** One line of a plan draft. `skillTypeId` is null for a name the SDE doesn't know. */
export interface PlanDraftEntry {
  skillTypeId: number | null;
  skillName: string;
  level: number;
}

/**
 * A draft's starting point — an existing plan, a fit, or pasted EFT. Only the
 * lines: the creator holds the whole skill catalogue already, so everything
 * needed to expand, order and cost them is on hand.
 */
export interface PlanDraftSource {
  entries: PlanDraftEntry[];
  /**
   * Names the SDE had nothing for: plan lines that matched no skill (kept as
   * id-less entries), or fit items whose skills couldn't be counted.
   */
  unresolved: string[];
  /** The plan's or fit's own name, offered as the plan name while none is typed. */
  suggestedName: string | null;
}

/** One character's skill progress toward a group's priority fit or plan. */
export interface GroupObjectiveStatus {
  /** True when the character meets every required skill at the required level. */
  complete: boolean;
  /** SP still missing, prerequisites included. */
  spGap: number;
  /** Full SP the objective requires when trained from zero. */
  totalSp: number;
  /** 0..1 share of the objective's SP the character already holds. */
  progress: number;
  /** Whole Large Skill Injectors to close spGap; 0 when complete. */
  lsiGap: number;
  /** Attribute-based minutes to train the gap; null when the data is missing. */
  timeGapMinutes: number | null;
  missingSkillCount: number;
}

/** Everything the group page's member card shows for one character. */
export interface GroupMemberStatus {
  character: CharacterSummary;
  accountLabel: string | null;
  totalSp: number;
  training: TrainingStatus;
  /** Entries in the skill queue (including the one currently training). */
  queueLength: number;
  /** Finish date of the last queue entry; null when the queue is empty or paused. */
  queueEndDate: string | null;
  systemName: string | null;
  shipTypeName: string | null;
  tags: OrgRef[];
  /** Medical (home) clone location; null until clone data has synced. */
  medicalClone: CloneLocation | null;
  /** Null when the group has no priority fit or skill data isn't imported. */
  fitStatus: GroupObjectiveStatus | null;
  /** Null when the group has no priority plan or skill data isn't imported. */
  planStatus: GroupObjectiveStatus | null;
}

export interface GroupDetail {
  group: CharacterGroup;
  /** Resolved priority fit, so the page can label bars without another fetch. */
  priorityFit: { id: number; name: string; shipName: string } | null;
  priorityPlan: { id: number; name: string } | null;
  /** True when a priority objective is set but SDE skill data isn't imported yet. */
  needsSkillData: boolean;
  /** Members sorted by character name. */
  members: GroupMemberStatus[];
  /**
   * Members' pods carrying implants that are outside the group's pod-system
   * whitelist, in member order. Always empty when the whitelist is empty.
   * Pods the user chose to ignore are excluded — they appear in `podIgnored`.
   */
  podViolations: PodViolation[];
  /** Pods exempted from the whitelist check, managed on the Ignored tab. */
  podIgnored: PodIgnoredEntry[];
}

/** A member's pod (a clone carrying implants) outside the whitelisted systems. */
export interface PodViolation {
  characterId: number;
  characterName: string;
  /** 'active' = the body currently in use; 'jump-clone' = a stored clone. */
  kind: 'active' | 'jump-clone';
  /** ESI jump-clone id (jump clones only); unique per character. */
  jumpCloneId: number | null;
  /** Player-assigned clone name (jump clones only). */
  cloneName: string | null;
  implantCount: number;
  /** Resolved solar system; null when unverifiable (unresolved structure). */
  systemId: number | null;
  systemName: string | null;
  /** Station/structure id the pod sits at (jump clones only). */
  locationId: number | null;
  /** Station/structure name the pod sits at, when known (jump clones only). */
  locationName: string | null;
}

/**
 * A pod exempted from a group's whitelist check. Kept even when the clone is
 * currently compliant (or gone), so the exemption stays visible and can be
 * lifted at any time.
 */
export interface PodIgnoredEntry {
  characterId: number;
  characterName: string;
  /** 'active' = the body currently in use; 'jump-clone' = a stored clone. */
  kind: 'active' | 'jump-clone';
  /** ESI jump-clone id (jump clones only); unique per character. */
  jumpCloneId: number | null;
  cloneName: string | null;
  /** Null when the ignored jump clone no longer exists on the character. */
  implantCount: number | null;
  /** Where the pod currently sits, as far as it can be resolved. */
  systemId: number | null;
  systemName: string | null;
  locationId: number | null;
  locationName: string | null;
  /** False when the ignored jump clone no longer exists (jumped or destroyed). */
  exists: boolean;
  ignoredAt: string;
}

export interface AppNotification {
  id: number;
  kind: string;
  characterId: number | null;
  title: string;
  body: string;
  createdAt: string;
  readAt: string | null;
}

export interface JumpCloneEntry {
  jumpCloneId: number;
  /** Player-assigned clone name, if any. */
  name: string | null;
  locationId: number | null;
  locationType: string | null;
  /** Resolved station or structure name; null while unresolved. */
  locationName: string | null;
  implants: ImplantInfo[];
}

/**
 * Why a character's data for some ESI-backed feature may be missing or stale.
 * Feature-agnostic — any feature with its own required scopes reuses this:
 * - 'ok'            — data has synced.
 * - 'pending'       — scopes granted, first sync hasn't happened yet.
 * - 'scope-missing' — the stored token lacks required scope(s); re-add the character.
 * - 'login-expired' — SSO rejected the refresh token; re-add the character.
 */
export type EsiDataStatus = 'ok' | 'pending' | 'scope-missing' | 'login-expired';

export interface CloneBoardEntry {
  characterId: number;
  characterName: string;
  accountLabel: string | null;
  status: EsiDataStatus;
  /** Required scopes the character's token lacks (set when status is 'scope-missing'). */
  missingScopes: string[];
  /** Implants in the currently-active clone. */
  activeImplants: ImplantInfo[];
  clones: JumpCloneEntry[];
  /** Null until clone data has synced. */
  updatedAt: string | null;
  /** Next clone-jump availability; may be past (= ready). Null when never jumped. */
  nextCloneJumpAt: string | null;
  /** Medical (home) clone location; null until synced or when ESI omits it. */
  medicalClone: CloneLocation | null;
}

/** Who holds a blueprint — a character's own hangar, or a tracked alt corp's. */
export interface BlueprintHolder {
  kind: 'character' | 'corporation';
  id: number;
  name: string;
  materialEfficiency: number;
  timeEfficiency: number;
}

/** One blueprint in the checklist: what it is, and whether it is owned. */
export interface BlueprintCatalogEntry {
  typeId: number;
  name: string;
  /** The item one run makes; null for the rare blueprint with no product. */
  productTypeId: number | null;
  groupName: string | null;
  categoryName: string | null;
  /** Product's tech tier — 1 Tech I, 2 Tech II, 4 Faction, 14 Tech III, … */
  metaGroupId: number | null;
  /**
   * The blueprint has a market group, i.e. it exists as an *original*.
   * Invention- and drop-only blueprints have none and can never be ticked off,
   * so they sit behind the "show every blueprint" toggle.
   */
  marketSeeded: boolean;
  activity: 'manufacturing' | 'reaction' | 'other';
  /** Originals held across every character and tracked corp. */
  originals: number;
  /** Copies (BPCs) held — shown for context; a copy never ticks the checklist. */
  copies: number;
  holders: BlueprintHolder[];
  /** Best research levels among the originals held; null when none are. */
  bestMaterialEfficiency: number | null;
  bestTimeEfficiency: number | null;
}

/** One character's ability to report blueprints, for the coverage strip. */
export interface BlueprintCharacterCoverage {
  characterId: number;
  characterName: string;
  status: EsiDataStatus;
  missingScopes: string[];
  updatedAt: string | null;
  originals: number;
}

/** A tracked alt corp's blueprint hangar. */
export interface BlueprintCorpStatus {
  corporationId: number;
  name: string | null;
  ticker: string | null;
  readerCharacterId: number;
  readerCharacterName: string | null;
  syncedAt: string | null;
  /** Why the last read failed — almost always "reader is not a Director". */
  lastError: string | null;
  originals: number;
}

/**
 * The parts of the rollup that do not depend on how the page is filtered. How
 * many are *owned* deliberately is not here: that answer changes with the
 * page's "Originals only" and "Include copy-only" toggles, so it is counted
 * where those toggles live (`countOwned` in `lib/blueprintView.ts`) rather than
 * being shipped as a number that could disagree with the table under it.
 */
export interface BlueprintTotals {
  /** Blueprints that exist as originals (the checklist's real denominator). */
  seededTotal: number;
  /** Every published blueprint, including copy-only ones. */
  allTotal: number;
  /** Originals held whose type is not in the catalog (unpublished/removed types). */
  untracked: number;
}

export interface BlueprintBoard {
  /** blueprints.yaml has not been imported — there is no universe to check against. */
  needsBlueprintData: boolean;
  entries: BlueprintCatalogEntry[];
  totals: BlueprintTotals;
  characters: BlueprintCharacterCoverage[];
  corps: BlueprintCorpStatus[];
}

/**
 * A clone's location: station names resolve via public ESI, structure names
 * via the shared structures table (filled by character sync).
 */
export interface CloneLocation {
  locationId: number;
  locationType: string | null;
  locationName: string | null;
}

/**
 * One character's sync health on the Settings page:
 * - 'ok'            — cached ESI data is still fresh.
 * - 'due'           — cache lapsed; the next hourly sweep will sync it (routine).
 * - 'never-synced'  — added but no successful full sync yet.
 * - 'login-expired' — SSO rejected the refresh token; re-add the character.
 */
export type CharacterSyncState = 'ok' | 'due' | 'never-synced' | 'login-expired';

/** One row of the Settings page's per-character sync table. */
export interface CharacterSyncStatus {
  characterId: number;
  characterName: string;
  accountLabel: string | null;
  /** Last successful full sync (characters.refreshed_at). */
  refreshedAt: string | null;
  /** When the skills cache lapses and the character becomes due; null when uncached. */
  nextDueAt: string | null;
  state: CharacterSyncState;
  /** Scopes from the app's current scope set that this character's token lacks. */
  missingScopes: string[];
}

/** Everything the Settings page's sync-status section shows. */
export interface SyncStatusReport {
  scheduler: {
    running: boolean;
    lastSweepAt: string | null;
    /** Estimated next hourly sweep. */
    nextSweepAt: string | null;
  };
  sde: SdeStatus;
  structures: { total: number; resolved: number };
  characters: CharacterSyncStatus[];
  summary: {
    total: number;
    ok: number;
    due: number;
    neverSynced: number;
    loginExpired: number;
  };
}

/** Tray residency — whether sync keeps running once the window is closed. */
export interface BackgroundModeSettings {
  /** Persisted: closing the window drops to tray-only sync instead of quitting. */
  closeToTray: boolean;
  /** This process was launched with `--background` (tray-only from the start). */
  launchedInBackground: boolean;
  /** A tray icon is up right now. */
  trayActive: boolean;
}

/** Kinds of noteworthy ESI event captured by the structured ESI log. */
export type EsiEventKind =
  | 'throttle' // HTTP 420 (legacy error limit) or 429 (floating-window bucket)
  | 'retry' // 5xx transient retry
  | 'timeout' // request aborted at the client timeout
  | 'network-error' // fetch rejected (DNS, connection reset, offline, ...)
  | 'auth-refresh' // 401 -> token refresh + retry
  | 'give-up' // a retry/throttle budget was exhausted -> request threw
  | 'backoff' // the rate limiter opened/extended a backoff window
  | 'slow' // a successful request that took unusually long
  | 'sweep'; // a background sync sweep boundary (correlation marker)

/** One captured ESI event, newest last in {@link EsiActivitySummary.recentEvents}. */
export interface EsiActivityEvent {
  at: string;
  kind: EsiEventKind;
  /** ESI route, e.g. `/characters/123/clones`. */
  path?: string;
  characterId?: number;
  status?: number;
  ms?: number;
  /** 1-based attempt number this event occurred on. */
  attempt?: number;
  /** Seconds of backoff opened (throttle/backoff events). */
  backoffSeconds?: number;
  detail?: string;
}

/**
 * At-a-glance ESI request health: session counters plus the most recent
 * noteworthy events. Powers the Settings "ESI activity" readout and the
 * diagnostics export. Counters are cumulative for the current app run.
 */
export interface EsiActivitySummary {
  since: string;
  /** Requests that actually hit the network (excludes cache-fresh short-circuits). */
  requests: number;
  /** Served from a fresh cache entry without any network request. */
  cacheFresh: number;
  status: {
    ok200: number;
    notModified304: number;
    unauthorized401: number;
    throttled420: number;
    throttled429: number;
    serverError5xx: number;
    /** Other 4xx (403/404/…) that surfaced as an error. */
    otherError: number;
  };
  timeouts: number;
  networkErrors: number;
  giveUps: number;
  backoffWindows: number;
  totalBackoffSeconds: number;
  maxBackoffSeconds: number;
  slowRequests: number;
  /** Remaining seconds in the rate limiter's current backoff (0 when clear). */
  currentBackoffSeconds: number;
  recentEvents: EsiActivityEvent[];
}

/** Static app/runtime facts for the Settings page (About + backup sections). */
export interface AppInfo {
  version: string;
  platform: string;
  electronVersion: string;
  /** Absolute path of the SQLite database (what a backup copies). */
  dbPath: string;
  userDataPath: string;
  githubUrl: string;
  /** Migration version this profile is at — worth quoting in a bug report. */
  schemaVersion: number;
}

/**
 * Where the update sits: what the last check found, then how far an install
 * the user asked for has got.
 *
 * `unknown` covers every case where the check has no answer — never run, the
 * network was down, the repository has no published release yet — so the UI
 * can stay silent rather than claim the build is current. `downloading` and
 * `ready` only occur in a build that can install in place (see `canInstall`),
 * and only after the user clicked: nothing downloads on its own.
 */
export type UpdateState = 'current' | 'update-available' | 'downloading' | 'ready' | 'unknown';

export interface UpdateStatus {
  state: UpdateState;
  /** The running build. */
  currentVersion: string;
  /** Latest published release, once a check has succeeded and found one. */
  latestVersion: string | null;
  /** Release title, when it has one. */
  releaseName: string | null;
  /** The release page, falling back to the repository's release index. */
  releaseUrl: string;
  publishedAt: string | null;
  /** When the last successful check ran; null when none has. */
  checkedAt: string | null;
  /**
   * Why the check has no answer, or why a download stopped. Shown in Settings,
   * and in the banner too once there is a button there that can fail.
   */
  message: string | null;
  /** The banner has been dismissed for `latestVersion`. */
  dismissed: boolean;
  /** 0-100 while `state` is `downloading`; null in every other state. */
  downloadPercent: number | null;
  /**
   * This build can install an update in place — a packaged one, where
   * electron-builder wrote the update feed alongside the app. A build running
   * from source (or a future target without an updater) links to the release
   * page instead.
   */
  canInstall: boolean;
}

/** Tranquility server status, from ESI's public /status/ endpoint. */
export interface ServerStatus {
  /** False when the status call itself failed (network down, ESI outage). */
  online: boolean;
  /** Null when `online` is false. */
  players: number | null;
  vip: boolean;
}

/** MCO's own ESI-call health, independent of the game server. */
export interface EsiHealth {
  /** False while ESI has us in an error-limit backoff window. */
  healthy: boolean;
  /** Seconds remaining in the backoff window; 0 when healthy. */
  backoffSeconds: number;
}

/** Dashboard's "characters online" tile. */
export interface OnlineCharacterSummary {
  onlineCount: number;
  /** Characters whose token lacks esi-location.read_online.v1 (re-add to grant it). */
  missingScopeCount: number;
  totalCharacters: number;
}

/**
 * Everything a character *earned*: the Dashboard's "Income" tile and the
 * Wallet page's income cards. Kept as separate categories so the total can
 * still break out. Donations are deliberately not here — ISK someone handed
 * you is a transfer, not earnings, and it has its own card.
 */
export interface IncomeSummary {
  /** NPC bounty prizes + ESS reserve payouts. */
  bountyIsk: number;
  /** Agent mission / incursion completion rewards. */
  missionIsk: number;
  /**
   * `corporate_reward_payout` — in practice CONCORD paying for a completed
   * site ("CONCORD rewarded <name> for services performed"), not a corp
   * project. ESI reports it **already net of corp tax**, so this is what
   * actually landed in the wallet.
   */
  corpRewardIsk: number;
  /** bounty + mission + reward payouts. */
  totalIsk: number;
}

/**
 * Every wallet category MCO tracks, summed over one window across every
 * character. Outgoings (tax, donations sent) are **positive** numbers: the
 * direction lives in the field name, so nothing has to guess at a sign.
 */
export interface WalletTotals {
  income: IncomeSummary;
  /**
   * Tax paid: every `*_tax` ref_type that took ISK, plus tax withheld at
   * source. A floor, not a total — ESI omits some tax the in-game journal
   * shows (notably the corp's cut of a CONCORD reward payout).
   */
  taxIsk: number;
  /**
   * Running costs: `*_fee` ref_types plus skill purchases, Ansiblex tolls,
   * repair bills and PI construction. Excludes market escrow, contracts and
   * ISK moved between your own wallets — none of those are money spent.
   */
  expenseIsk: number;
  /** Player donations received from outside the roster. */
  donationsInIsk: number;
  /** Player donations sent outside the roster. */
  donationsOutIsk: number;
  /**
   * Donations between two tracked characters — ISK moved, not earned or spent,
   * so it is kept out of the in/out figures and reported on its own.
   */
  internalTransferIsk: number;
}

/** One calendar month of totals, for the Wallet page's previous-months view. */
export interface WalletMonthTotals extends WalletTotals {
  /** UTC calendar month, YYYY-MM. */
  month: string;
}

/**
 * One UTC day of totals — one column of the Wallet page's by-day chart. Carries
 * every category the monthly view does, so the two charts read the same
 * activity at two granularities.
 */
export interface WalletDayTotals extends WalletTotals {
  /** UTC calendar day, YYYY-MM-DD. */
  day: string;
}

/** Everything the Wallet page shows. */
export interface WalletSummary {
  /** The current UTC calendar month. */
  totals: WalletTotals;
  /** One entry per UTC day from the month's start through today (zero-filled). */
  byDay: WalletDayTotals[];
  /**
   * Completed months, oldest → newest. Only months MCO was running for: ESI's
   * journal reaches ~30 days back, so history accrues from the first sync on.
   */
  previousMonths: WalletMonthTotals[];
}

/** One character in the Dashboard's SP packed-circles chart (sized by total SP). */
export interface DashboardCharacterEntry {
  characterId: number;
  characterName: string;
  totalSp: number;
}

/** Everything the Dashboard page shows. */
export interface DashboardSummary {
  serverStatus: ServerStatus;
  esiHealth: EsiHealth;
  online: OnlineCharacterSummary;
  charactersRegistered: number;
  totalSp: number;
  income: IncomeSummary;
  /** Every character with total SP, for the packed-circles chart (unordered). */
  characters: DashboardCharacterEntry[];
}
