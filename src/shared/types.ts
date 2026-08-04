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
 * Total trained skill points in one SDE skill group, summed across the whole
 * roster. Feeds the Roster skill-distribution radar (skill groups around the
 * circular axis, combined SP on the radial axis).
 */
export interface SkillGroupSp {
  /** Skill-group name from the SDE (e.g. "Gunnery", "Spaceship Command"). */
  group: string;
  /** Combined trained SP in this group across every character. */
  sp: number;
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

/** Dashboard's "ratted ISK this month" tile; kept as separate categories so it can break out. */
export interface RattedIskSummary {
  /** NPC bounty prizes + ESS reserve payouts. */
  bountyIsk: number;
  /** Agent mission / incursion completion rewards. */
  missionIsk: number;
  totalIsk: number;
}

/** One column of the Wallet page's income chart. */
export interface RattedIskDay {
  /** UTC calendar day, YYYY-MM-DD. */
  day: string;
  bountyIsk: number;
  missionIsk: number;
}

/** Everything the Wallet page shows: current-month ratted income. */
export interface WalletSummary {
  rattedIsk: RattedIskSummary;
  /** One entry per UTC day from the month's start through today (zero-filled). */
  rattedIskByDay: RattedIskDay[];
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
  rattedIsk: RattedIskSummary;
  /** Every character with total SP, for the packed-circles chart (unordered). */
  characters: DashboardCharacterEntry[];
}
