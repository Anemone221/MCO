import type {
  AccountBucket,
  AppInfo,
  AppNotification,
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
  RosterEntry,
  SdeProgress,
  SdeStatus,
  SkillPlan,
  StructureImportProgress,
  StructureSearchResult,
  SyncResult,
  SyncStatusReport,
  SystemSearchResult,
  Tag,
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
  plansRemove: 'plans:remove',
  plansAnalyze: 'plans:analyze',
  locationBoard: 'location:board',
  structuresImport: 'structures:import',
  structuresImportProgress: 'structures:importProgress',
  structuresSearch: 'structures:search',
  systemsSearch: 'systems:search',
  clonesBoard: 'clones:board',
  dashboardSummary: 'dashboard:summary',
  walletSummary: 'wallet:summary',
  notificationsList: 'notifications:list',
  notificationsMarkRead: 'notifications:markRead',
  notificationsMarkAllRead: 'notifications:markAllRead',
  notificationsChanged: 'notifications:changed',
  systemClientConfigured: 'system:clientConfigured',
  systemAppInfo: 'system:appInfo',
  systemConfirm: 'system:confirm',
  settingsSyncStatus: 'settings:syncStatus',
  settingsEsiActivity: 'settings:esiActivity',
  settingsExportLogs: 'settings:exportLogs',
  settingsExportBackup: 'settings:exportBackup',
  settingsOpenDataFolder: 'settings:openDataFolder',
} as const;

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
    remove: (planId: number) => Promise<void>;
    analyze: (planId: number) => Promise<PlanAnalysis>;
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
  };
}
