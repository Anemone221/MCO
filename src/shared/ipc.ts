import type {
  AccountBucket,
  AppInfo,
  AppNotification,
  BackgroundModeSettings,
  BlueprintBoard,
  CharacterDetail,
  CharacterGroup,
  CharacterSummary,
  CloneBoardEntry,
  DashboardSummary,
  EsiActivitySummary,
  Fit,
  FitAnalysis,
  GroupDetail,
  LocationEntry,
  PlanAnalysis,
  PlanDraftSource,
  PlanSkillInfo,
  RosterEntry,
  SdeProgress,
  SdeStatus,
  ShipInfo,
  SkillPlan,
  StructureImportProgress,
  StructureSearchResult,
  SyncResult,
  SyncStatusReport,
  SystemSearchResult,
  Tag,
  UpdateStatus,
  WalletSummary,
} from './types';

export const IpcChannel = {
  charactersRoster: 'characters:roster',
  charactersAdd: 'characters:add',
  charactersRemove: 'characters:remove',
  charactersSync: 'characters:sync',
  charactersSyncAll: 'characters:syncAll',
  charactersAssignAccount: 'characters:assignAccount',
  charactersDetail: 'characters:detail',
  charactersChanged: 'characters:changed',
  accountsList: 'accounts:list',
  accountsCreate: 'accounts:create',
  accountsRename: 'accounts:rename',
  accountsSetOmega: 'accounts:setOmega',
  accountsRemove: 'accounts:remove',
  groupsList: 'groups:list',
  groupsDetail: 'groups:detail',
  groupsCreate: 'groups:create',
  groupsRename: 'groups:rename',
  groupsSetPriorityFit: 'groups:setPriorityFit',
  groupsSetPriorityPlan: 'groups:setPriorityPlan',
  groupsSetHomeStation: 'groups:setHomeStation',
  groupsAddPodSystem: 'groups:addPodSystem',
  groupsRemovePodSystem: 'groups:removePodSystem',
  groupsIgnorePod: 'groups:ignorePod',
  groupsUnignorePod: 'groups:unignorePod',
  groupsRemove: 'groups:remove',
  groupsAddMember: 'groups:addMember',
  groupsRemoveMember: 'groups:removeMember',
  tagsList: 'tags:list',
  tagsCreate: 'tags:create',
  tagsRename: 'tags:rename',
  tagsSetColor: 'tags:setColor',
  tagsRemove: 'tags:remove',
  tagsAddMember: 'tags:addMember',
  tagsAddMembers: 'tags:addMembers',
  tagsRemoveMember: 'tags:removeMember',
  sdeStatus: 'sde:status',
  sdeImport: 'sde:import',
  sdeProgress: 'sde:progress',
  fitsList: 'fits:list',
  fitsImport: 'fits:import',
  fitsRemove: 'fits:remove',
  fitsAnalyze: 'fits:analyze',
  plansList: 'plans:list',
  plansImport: 'plans:import',
  plansUpdate: 'plans:update',
  plansRemove: 'plans:remove',
  plansAnalyze: 'plans:analyze',
  plansSkillCatalog: 'plans:skillCatalog',
  plansShipCatalog: 'plans:shipCatalog',
  plansDraft: 'plans:draft',
  plansDraftFromFit: 'plans:draftFromFit',
  plansDraftFromEft: 'plans:draftFromEft',
  locationBoard: 'location:board',
  structuresImport: 'structures:import',
  structuresImportProgress: 'structures:importProgress',
  structuresSearch: 'structures:search',
  systemsSearch: 'systems:search',
  clonesBoard: 'clones:board',
  blueprintsBoard: 'blueprints:board',
  blueprintsRefresh: 'blueprints:refresh',
  blueprintsAddCorp: 'blueprints:addCorp',
  blueprintsRemoveCorp: 'blueprints:removeCorp',
  dashboardSummary: 'dashboard:summary',
  walletSummary: 'wallet:summary',
  notificationsList: 'notifications:list',
  notificationsMarkRead: 'notifications:markRead',
  notificationsMarkAllRead: 'notifications:markAllRead',
  notificationsChanged: 'notifications:changed',
  systemClientConfigured: 'system:clientConfigured',
  systemAppInfo: 'system:appInfo',
  systemConfirm: 'system:confirm',
  systemCopyText: 'system:copyText',
  systemCheckUpdate: 'system:checkUpdate',
  systemDismissUpdate: 'system:dismissUpdate',
  settingsSyncStatus: 'settings:syncStatus',
  settingsEsiActivity: 'settings:esiActivity',
  settingsExportLogs: 'settings:exportLogs',
  settingsExportBackup: 'settings:exportBackup',
  settingsOpenDataFolder: 'settings:openDataFolder',
  settingsBackgroundMode: 'settings:backgroundMode',
  settingsSetCloseToTray: 'settings:setCloseToTray',
  settingsRunInBackground: 'settings:runInBackground',
} as const;

/** Any declared channel name — what the main/preload wrappers key on. */
export type IpcChannelName = (typeof IpcChannel)[keyof typeof IpcChannel];

/**
 * Channels the main process *pushes* on (`webContents.send`) rather than ones
 * the renderer invokes: they are subscribed to in preload and have no handler.
 * Listed so the wiring check can tell "no handler by design" from "no handler by
 * mistake" — see `main/ipc/coverage.ts`.
 */
export const IPC_EVENT_CHANNELS: readonly IpcChannelName[] = [
  IpcChannel.charactersChanged,
  IpcChannel.sdeProgress,
  IpcChannel.structuresImportProgress,
  IpcChannel.notificationsChanged,
];

export interface SdeImportSummary {
  version: string;
  typeCount: number;
}

export interface StructureImportSummary {
  /** How many public structures ESI listed. */
  totalPublic: number;
  /** Structures fetched and named this run (fresh ones are skipped). */
  resolved: number;
  /** Fetches that failed (throttled before retrying). */
  failed: number;
}

/** The typed surface exposed to the renderer on `window.mco`. */
export interface McoApi {
  characters: {
    roster: () => Promise<RosterEntry[]>;
    add: () => Promise<CharacterSummary>;
    remove: (characterId: number) => Promise<void>;
    sync: (characterId: number) => Promise<void>;
    syncAll: () => Promise<SyncResult[]>;
    assignAccount: (characterId: number, accountId: number | null) => Promise<void>;
    detail: (characterId: number) => Promise<CharacterDetail>;
    /** Subscribe to background-sync updates. Returns an unsubscribe function. */
    onChanged: (callback: () => void) => () => void;
  };
  accounts: {
    list: () => Promise<AccountBucket[]>;
    create: (label: string, color?: string | null) => Promise<AccountBucket>;
    rename: (accountId: number, label: string) => Promise<void>;
    setOmega: (accountId: number, isOmega: boolean) => Promise<void>;
    remove: (accountId: number) => Promise<void>;
  };
  groups: {
    list: () => Promise<CharacterGroup[]>;
    detail: (groupId: number) => Promise<GroupDetail>;
    create: (name: string, color?: string | null) => Promise<CharacterGroup>;
    rename: (groupId: number, name: string) => Promise<void>;
    setPriorityFit: (groupId: number, fitId: number | null) => Promise<void>;
    setPriorityPlan: (groupId: number, planId: number | null) => Promise<void>;
    /** Home station members' medical clones should be at; null clears it. */
    setHomeStation: (
      groupId: number,
      station: { id: number; name: string } | null,
    ) => Promise<void>;
    /** Add a solar system to the pod-location whitelist. */
    addPodSystem: (groupId: number, system: { id: number; name: string }) => Promise<void>;
    /** Remove a solar system from the pod-location whitelist. */
    removePodSystem: (groupId: number, solarSystemId: number) => Promise<void>;
    /** Exempt a pod from the whitelist check; null jumpCloneId = the active pod. */
    ignorePod: (groupId: number, characterId: number, jumpCloneId: number | null) => Promise<void>;
    /** Lift a pod's exemption; null jumpCloneId = the active pod. */
    unignorePod: (
      groupId: number,
      characterId: number,
      jumpCloneId: number | null,
    ) => Promise<void>;
    remove: (groupId: number) => Promise<void>;
    addMember: (groupId: number, characterId: number) => Promise<void>;
    removeMember: (groupId: number, characterId: number) => Promise<void>;
  };
  tags: {
    list: () => Promise<Tag[]>;
    create: (name: string, color?: string | null) => Promise<Tag>;
    rename: (tagId: number, name: string) => Promise<void>;
    setColor: (tagId: number, color: string | null) => Promise<void>;
    remove: (tagId: number) => Promise<void>;
    addMember: (tagId: number, characterId: number) => Promise<void>;
    /** Attach one tag to many characters at once (bulk fit/plan section tagging). */
    addMembers: (tagId: number, characterIds: number[]) => Promise<void>;
    removeMember: (tagId: number, characterId: number) => Promise<void>;
  };
  sde: {
    status: () => Promise<SdeStatus>;
    import: () => Promise<SdeImportSummary>;
    onProgress: (callback: (progress: SdeProgress) => void) => () => void;
  };
  fits: {
    list: () => Promise<Fit[]>;
    import: (eftText: string) => Promise<Fit>;
    remove: (fitId: number) => Promise<void>;
    analyze: (fitId: number) => Promise<FitAnalysis>;
  };
  plans: {
    list: () => Promise<SkillPlan[]>;
    import: (name: string, planText: string) => Promise<SkillPlan>;
    /** Overwrite a plan the creator re-saved, keeping its id (and references). */
    update: (planId: number, name: string, planText: string) => Promise<SkillPlan>;
    remove: (planId: number) => Promise<void>;
    analyze: (planId: number) => Promise<PlanAnalysis>;
    /**
     * Every skill in the game with its group, rank, attributes, per-level SP
     * and prerequisites — the creator's browser, and everything it needs to
     * expand and cost a draft locally.
     */
    skillCatalog: () => Promise<PlanSkillInfo[]>;
    /** Every hull with the skills flying it needs — the ship browser. */
    shipCatalog: () => Promise<ShipInfo[]>;
    /** Open a stored plan in the creator, its written order intact. */
    draft: (planId: number) => Promise<PlanDraftSource>;
    /** The skills a stored fit requires, as draft entries. */
    draftFromFit: (fitId: number) => Promise<PlanDraftSource>;
    /** The skills a pasted EFT block requires, without storing the fit. */
    draftFromEft: (eftText: string) => Promise<PlanDraftSource>;
  };
  location: {
    board: () => Promise<LocationEntry[]>;
  };
  structures: {
    /** Import every public structure's name/system via ESI (needs one scoped character). */
    importPublic: () => Promise<StructureImportSummary>;
    onImportProgress: (
      callback: (progress: StructureImportProgress) => void,
    ) => () => void;
    /** Name-search over imported structures (home-station picker). */
    search: (query: string) => Promise<StructureSearchResult[]>;
  };
  systems: {
    /** Name-search over SDE solar systems (pod-whitelist picker). */
    search: (query: string) => Promise<SystemSearchResult[]>;
  };
  clones: {
    board: () => Promise<CloneBoardEntry[]>;
  };
  blueprints: {
    /** The checklist: the SDE's blueprint universe with owned originals counted against it. */
    board: () => Promise<BlueprintBoard>;
    /** Re-read every tracked corp hangar now, ignoring the failure cooldown. */
    refresh: () => Promise<BlueprintBoard>;
    /**
     * Track an alt corp: signs one character in with the opt-in corporation
     * scope and makes it that corp's reader. Rejects with a readable reason if
     * the character is in an NPC corp or lacks the Director role.
     */
    addCorp: () => Promise<BlueprintBoard>;
    removeCorp: (corporationId: number) => Promise<void>;
  };
  dashboard: {
    summary: () => Promise<DashboardSummary>;
  };
  wallet: {
    summary: () => Promise<WalletSummary>;
  };
  notifications: {
    list: () => Promise<AppNotification[]>;
    markRead: (id: number) => Promise<void>;
    markAllRead: () => Promise<void>;
    /** Subscribe to new/updated notifications. Returns an unsubscribe function. */
    onChanged: (callback: () => void) => () => void;
  };
  system: {
    isClientConfigured: () => Promise<boolean>;
    appInfo: () => Promise<AppInfo>;
    /**
     * Native confirmation dialog. Never use window.confirm: the synchronous dialog
     * desyncs Chromium's focus state and text inputs stop taking keystrokes until
     * the window is refocused.
     */
    confirm: (message: string, confirmLabel?: string) => Promise<boolean>;
    /**
     * Put text on the OS clipboard. Electron's own clipboard rather than
     * `navigator.clipboard`: the renderer is sandboxed and a packaged build
     * loads from `file://`, where the web API is not guaranteed a permission.
     */
    copyText: (text: string) => Promise<void>;
    /**
     * Whether a newer release is published on GitHub. Answers from a cache
     * refreshed at most daily; `force` checks now regardless. Never rejects —
     * a failed check resolves with the last known answer and a `message`.
     */
    checkUpdate: (force?: boolean) => Promise<UpdateStatus>;
    /** Hide the update banner for one version; anything newer raises it again. */
    dismissUpdate: (version: string) => Promise<UpdateStatus>;
  };
  settings: {
    /** Sync health of everything the app keeps fresh (characters, SDE, structures). */
    syncStatus: () => Promise<SyncStatusReport>;
    /** ESI request health this run: status/throttle/timeout counters + recent events. */
    esiActivity: () => Promise<EsiActivitySummary>;
    /** Save a diagnostics file via a save dialog; resolves to the path, or null if cancelled. */
    exportLogs: () => Promise<string | null>;
    /** Save a SQLite backup via a save dialog; resolves to the path, or null if cancelled. */
    exportBackup: () => Promise<string | null>;
    /** Open the profile's data folder (where mco.sqlite lives) in the OS file manager. */
    openDataFolder: () => Promise<void>;
    /** Tray residency: whether sync keeps running once the window is closed. */
    backgroundMode: () => Promise<BackgroundModeSettings>;
    /** Persist close-to-tray; resolves to the resulting state. */
    setCloseToTray: (enabled: boolean) => Promise<BackgroundModeSettings>;
    /**
     * Close the window now and keep syncing from the tray. Resolves to the
     * resulting state — the window stays open if no tray icon could be raised.
     */
    runInBackground: () => Promise<BackgroundModeSettings>;
  };
}
