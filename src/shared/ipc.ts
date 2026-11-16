import type { NotificationKind, NotificationPreferences } from './notifications';
import type {
  AccountBucket,
  AppInfo,
  AppNotification,
  BackgroundModeSettings,
  BackupInfo,
  BlueprintBoard,
  CharacterDetail,
  CharacterGroup,
  CloneBoardEntry,
  DashboardSummary,
  EsiActivitySummary,
  Fit,
  FitAnalysis,
  GroupDetail,
  LocationEntry,
  LoginResult,
  MercenaryBoard,
  MiningSummary,
  NearestBoard,
  PlanAnalysis,
  PlanDraftSource,
  PlanSkillInfo,
  RosterEntry,
  RosterPlanProgress,
  SdeProgress,
  SdeStatus,
  SdeUpdateStatus,
  ShipInfo,
  SkillPlan,
  StructureImportProgress,
  StructureSearchResult,
  SyncProgress,
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
  charactersReauthorize: 'characters:reauthorize',
  charactersCancelLogin: 'characters:cancelLogin',
  charactersRemove: 'characters:remove',
  charactersSync: 'characters:sync',
  charactersSyncAll: 'characters:syncAll',
  charactersSyncMany: 'characters:syncMany',
  charactersAssignAccount: 'characters:assignAccount',
  charactersAssignAccounts: 'characters:assignAccounts',
  charactersDetail: 'characters:detail',
  charactersChanged: 'characters:changed',
  charactersSyncProgress: 'characters:syncProgress',
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
  groupsAddMembers: 'groups:addMembers',
  groupsRemoveMember: 'groups:removeMember',
  groupsRemoveMembers: 'groups:removeMembers',
  tagsList: 'tags:list',
  tagsCreate: 'tags:create',
  tagsRename: 'tags:rename',
  tagsSetColor: 'tags:setColor',
  tagsRemove: 'tags:remove',
  tagsAddMember: 'tags:addMember',
  tagsAddMembers: 'tags:addMembers',
  tagsRemoveMember: 'tags:removeMember',
  tagsRemoveMembers: 'tags:removeMembers',
  sdeStatus: 'sde:status',
  sdeImport: 'sde:import',
  sdeCheckUpdate: 'sde:checkUpdate',
  sdeDismissUpdate: 'sde:dismissUpdate',
  sdeProgress: 'sde:progress',
  fitsList: 'fits:list',
  fitsImport: 'fits:import',
  fitsRemove: 'fits:remove',
  fitsAnalyze: 'fits:analyze',
  plansList: 'plans:list',
  plansImport: 'plans:import',
  plansUpdate: 'plans:update',
  plansRemove: 'plans:remove',
  plansSetSheetVisibility: 'plans:setSheetVisibility',
  plansSetRosterVisibility: 'plans:setRosterVisibility',
  plansRosterProgress: 'plans:rosterProgress',
  plansAnalyze: 'plans:analyze',
  plansSkillCatalog: 'plans:skillCatalog',
  plansShipCatalog: 'plans:shipCatalog',
  plansDraft: 'plans:draft',
  plansDraftFromFit: 'plans:draftFromFit',
  plansDraftFromEft: 'plans:draftFromEft',
  locationBoard: 'location:board',
  locationNearest: 'location:nearest',
  structuresImport: 'structures:import',
  structuresImportProgress: 'structures:importProgress',
  structuresSearch: 'structures:search',
  systemsSearch: 'systems:search',
  clonesBoard: 'clones:board',
  clonesSetCritical: 'clones:setCritical',
  blueprintsBoard: 'blueprints:board',
  blueprintsRefresh: 'blueprints:refresh',
  blueprintsAddCorp: 'blueprints:addCorp',
  blueprintsRemoveCorp: 'blueprints:removeCorp',
  dashboardSummary: 'dashboard:summary',
  walletSummary: 'wallet:summary',
  miningSummary: 'mining:summary',
  mercenaryBoard: 'mercenary:board',
  notificationsList: 'notifications:list',
  notificationsMarkRead: 'notifications:markRead',
  notificationsMarkAllRead: 'notifications:markAllRead',
  notificationsDismiss: 'notifications:dismiss',
  notificationsDismissAll: 'notifications:dismissAll',
  notificationsPreferences: 'notifications:preferences',
  notificationsSetPreference: 'notifications:setPreference',
  notificationsChanged: 'notifications:changed',
  systemClientConfigured: 'system:clientConfigured',
  systemAppInfo: 'system:appInfo',
  systemConfirm: 'system:confirm',
  systemCopyText: 'system:copyText',
  systemCheckUpdate: 'system:checkUpdate',
  systemDismissUpdate: 'system:dismissUpdate',
  systemDownloadUpdate: 'system:downloadUpdate',
  systemInstallUpdate: 'system:installUpdate',
  systemSetAutoCheckUpdate: 'system:setAutoCheckUpdate',
  updateProgress: 'update:progress',
  settingsSyncStatus: 'settings:syncStatus',
  settingsEsiActivity: 'settings:esiActivity',
  settingsExportLogs: 'settings:exportLogs',
  settingsExportBackup: 'settings:exportBackup',
  settingsBackups: 'settings:backups',
  settingsRestoreBackup: 'settings:restoreBackup',
  settingsOpenDataFolder: 'settings:openDataFolder',
  settingsBackgroundMode: 'settings:backgroundMode',
  settingsSetCloseToTray: 'settings:setCloseToTray',
  settingsRunInBackground: 'settings:runInBackground',
  settingsLiveTracking: 'settings:liveTracking',
  settingsSetLiveTracking: 'settings:setLiveTracking',
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
  IpcChannel.charactersSyncProgress,
  IpcChannel.sdeProgress,
  IpcChannel.structuresImportProgress,
  IpcChannel.notificationsChanged,
  IpcChannel.updateProgress,
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
    /**
     * Sign a character in through EVE SSO and store it. Resolves once the
     * browser round trip is over — with `cancelled` if `cancelLogin` ended it.
     *
     * `deferSync` returns as soon as the login is stored and lets the first
     * sync finish in the background (announced on `onChanged`), so the next
     * sign-in of a run can start without waiting for it.
     */
    add: (deferSync?: boolean) => Promise<LoginResult>;
    /**
     * Run SSO again for a tracked character whose login expired or whose token
     * lacks a scope, keeping any opt-in scope it holds. The first sync is
     * deferred. Check the returned character's id: the user chooses the
     * character on CCP's page, and may have chosen another.
     */
    reauthorize: (characterId: number) => Promise<LoginResult>;
    /**
     * Call off the sign-in that is waiting on the browser, freeing the callback
     * port at once. Resolves to whether there was one.
     */
    cancelLogin: () => Promise<boolean>;
    remove: (characterId: number) => Promise<void>;
    sync: (characterId: number) => Promise<void>;
    syncAll: () => Promise<SyncResult[]>;
    /** Sync a chosen set of characters, reporting on `onSyncProgress` like "Sync all". */
    syncMany: (characterIds: number[]) => Promise<SyncResult[]>;
    assignAccount: (characterId: number, accountId: number | null) => Promise<void>;
    /** Move many characters into one account (null = unassigned) in one transaction. */
    assignAccounts: (characterIds: number[], accountId: number | null) => Promise<void>;
    detail: (characterId: number) => Promise<CharacterDetail>;
    /** Subscribe to background-sync updates. Returns an unsubscribe function. */
    onChanged: (callback: () => void) => () => void;
    /**
     * Subscribe to the progress of a multi-character sync — "Sync all" or a
     * background sweep. Returns an unsubscribe function.
     */
    onSyncProgress: (callback: (progress: SyncProgress) => void) => () => void;
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
    /** Add many characters to one group at once (Roster bulk bar). */
    addMembers: (groupId: number, characterIds: number[]) => Promise<void>;
    removeMembers: (groupId: number, characterIds: number[]) => Promise<void>;
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
    removeMembers: (tagId: number, characterIds: number[]) => Promise<void>;
  };
  sde: {
    status: () => Promise<SdeStatus>;
    /** Imports whatever build CCP currently publishes, replacing what is there. */
    import: () => Promise<SdeImportSummary>;
    /**
     * Whether a newer static data build exists. Cached for a day; `force`
     * asks CCP now.
     */
    checkUpdate: (force?: boolean) => Promise<SdeUpdateStatus>;
    /** Hide the new-build banner for one build. */
    dismissUpdate: (build: string) => Promise<SdeUpdateStatus>;
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
    /** Show or hide this plan on every character sheet's "Skill plans" card. */
    setSheetVisibility: (planId: number, show: boolean) => Promise<SkillPlan>;
    /** Give this plan (or take away) a progress column on the Roster table. */
    setRosterVisibility: (planId: number, show: boolean) => Promise<SkillPlan>;
    /** Every character's progress toward each roster-visible plan. */
    rosterProgress: () => Promise<RosterPlanProgress>;
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
    /**
     * Every character ranked by distance from one solar system — gate jumps to
     * get there, light years for a capital to jump to them. Filtering by
     * capability ("which of my cyno alts?") happens in the renderer, which
     * already holds the tag lists.
     *
     * `includeJumpClones` measures each character's jump clones too, so a
     * character that can *jump* to the target area outranks one that has to
     * fly. Opt-in: resolving clone locations to systems costs ESI station
     * lookups the plain ranking never needs.
     */
    nearest: (solarSystemId: number, includeJumpClones?: boolean) => Promise<NearestBoard>;
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
    /**
     * Mark (or unmark) an implant set as critical for a character: undocking
     * while wearing it raises a warning. Keyed by the implants, not the clone,
     * so the flag follows the pod when the character jumps into it. `label`
     * names the set in the warning (the clone's name, when it has one).
     */
    setCritical: (
      characterId: number,
      implantTypeIds: number[],
      critical: boolean,
      label: string | null,
    ) => Promise<void>;
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
  mining: {
    /**
     * The mining ledger over the last `days` UTC days (1 = today), or
     * everything banked when `days` is null. ESI only reaches ~30 days back,
     * so longer windows are answered from what past sweeps stored.
     */
    summary: (days: number | null) => Promise<MiningSummary>;
  };
  mercenary: {
    /**
     * Every Mercenary Den the roster holds, with its state, evolution meters
     * and the tactical operations standing at it. Read-only: MCO reports what
     * a den is doing, it cannot start an operation — ESI offers no write route
     * for that, and the game is where you run one.
     */
    board: () => Promise<MercenaryBoard>;
  };
  notifications: {
    /** Every notification not yet dismissed, newest first. */
    list: () => Promise<AppNotification[]>;
    markRead: (id: number) => Promise<void>;
    markAllRead: () => Promise<void>;
    /**
     * Drop one notification from the bell for good. The row itself is kept as
     * the record that its occurrence was already reported, so dismissing a
     * warning that is still true does not invite it back on the next sweep.
     */
    dismiss: (id: number) => Promise<void>;
    /** Dismiss every listed notification. Resolves with how many were cleared. */
    dismissAll: () => Promise<number>;
    /** Which notification kinds are switched on (Settings → Notifications). */
    preferences: () => Promise<NotificationPreferences>;
    /**
     * Switch one kind on or off. A kind that is off raises neither a toast nor
     * a bell row. Resolves to every kind's resulting state.
     */
    setPreference: (kind: NotificationKind, enabled: boolean) => Promise<NotificationPreferences>;
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
    /**
     * Download the pending update. Resolves as soon as it has *started* — the
     * rest arrives on `onUpdateProgress`. Only meaningful when the status says
     * `canInstall`; never rejects, a refusal comes back in `message`.
     */
    downloadUpdate: () => Promise<UpdateStatus>;
    /**
     * Quit, install what was downloaded, and relaunch. The app goes away, so
     * this resolves only when it declined to (nothing downloaded yet).
     */
    installUpdate: () => Promise<UpdateStatus>;
    /**
     * Turn the automatic release check on or off, answering the first-launch
     * prompt or the Settings toggle. Turning it on checks straight away, so the
     * status that comes back is a fresh one.
     */
    setAutoCheckUpdate: (enabled: boolean) => Promise<UpdateStatus>;
    /** Subscribe to download progress and phase changes. Returns an unsubscribe function. */
    onUpdateProgress: (callback: (status: UpdateStatus) => void) => () => void;
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
    /**
     * The snapshots MCO took on its own — weekly, before a schema migration and
     * before a restore — newest first. They live in the profile's `backups`
     * folder.
     */
    backups: () => Promise<BackupInfo[]>;
    /**
     * Replace the database with one of those snapshots. MCO restarts to do it:
     * the swap happens before the database is opened, never under a running
     * sync. Does not resolve on success — the app is on its way out.
     */
    restoreBackup: (fileName: string) => Promise<void>;
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
    /**
     * Live tracking: presence polling every 2 min, and location/implants every
     * ~20 s for online characters (drives the critical-clone undock warning).
     */
    liveTracking: () => Promise<boolean>;
    /** Persist and apply the live-tracking switch; resolves to the resulting state. */
    setLiveTracking: (enabled: boolean) => Promise<boolean>;
  };
}
