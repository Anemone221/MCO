import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IpcChannel, type IpcChannelName, type McoApi } from '@shared/ipc';
import { cleanIpcErrorMessage } from '@shared/ipcError';
import type { SdeProgress, StructureImportProgress } from '@shared/types';

/**
 * Every request/response call goes through here, so a handler that rejected
 * reaches the renderer as a sentence it can display as-is.
 *
 * Main has already decided what the message may say (`src/main/errors.ts`);
 * Electron then wraps it in `Error invoking remote method '<channel>': Error: …`
 * on the way across. That wrapper is plumbing — strip it here rather than in
 * every page's catch block.
 */
async function invoke<T>(channel: IpcChannelName, ...args: unknown[]): Promise<T> {
  try {
    return (await ipcRenderer.invoke(channel, ...args)) as T;
  } catch (err) {
    throw new Error(cleanIpcErrorMessage(err));
  }
}

/**
 * Bind a channel to one request/response method.
 *
 * The argument and return types come from the contextual type of the `McoApi`
 * member being assigned, so the channel is the only thing written by hand and
 * `McoApi` stays the single description of the surface.
 *
 * An omitted optional argument crosses as `null`, never `undefined`: the main
 * handlers all declare theirs `T | null` and hand them straight to prepared
 * statements, which reject an `undefined` bind.
 */
function call<A extends unknown[], R>(channel: IpcChannelName): (...args: A) => Promise<R> {
  return (...args) => invoke<R>(channel, ...args.map((arg) => arg ?? null));
}

/**
 * Bind a main→renderer event to one subscribe method: registers the listener
 * and hands back its remover, so an effect's cleanup can't leak one.
 */
function subscribe<P = void>(
  channel: IpcChannelName,
): (callback: (payload: P) => void) => () => void {
  return (callback) => {
    const listener = (_event: IpcRendererEvent, payload: P): void => callback(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  };
}

const api: McoApi = {
  characters: {
    roster: call(IpcChannel.charactersRoster),
    add: call(IpcChannel.charactersAdd),
    remove: call(IpcChannel.charactersRemove),
    sync: call(IpcChannel.charactersSync),
    syncAll: call(IpcChannel.charactersSyncAll),
    assignAccount: call(IpcChannel.charactersAssignAccount),
    detail: call(IpcChannel.charactersDetail),
    onChanged: subscribe(IpcChannel.charactersChanged),
  },
  accounts: {
    list: call(IpcChannel.accountsList),
    create: call(IpcChannel.accountsCreate),
    rename: call(IpcChannel.accountsRename),
    setOmega: call(IpcChannel.accountsSetOmega),
    remove: call(IpcChannel.accountsRemove),
  },
  groups: {
    list: call(IpcChannel.groupsList),
    detail: call(IpcChannel.groupsDetail),
    create: call(IpcChannel.groupsCreate),
    rename: call(IpcChannel.groupsRename),
    setPriorityFit: call(IpcChannel.groupsSetPriorityFit),
    setPriorityPlan: call(IpcChannel.groupsSetPriorityPlan),
    setHomeStation: call(IpcChannel.groupsSetHomeStation),
    addPodSystem: call(IpcChannel.groupsAddPodSystem),
    removePodSystem: call(IpcChannel.groupsRemovePodSystem),
    ignorePod: call(IpcChannel.groupsIgnorePod),
    unignorePod: call(IpcChannel.groupsUnignorePod),
    remove: call(IpcChannel.groupsRemove),
    addMember: call(IpcChannel.groupsAddMember),
    removeMember: call(IpcChannel.groupsRemoveMember),
  },
  tags: {
    list: call(IpcChannel.tagsList),
    create: call(IpcChannel.tagsCreate),
    rename: call(IpcChannel.tagsRename),
    setColor: call(IpcChannel.tagsSetColor),
    remove: call(IpcChannel.tagsRemove),
    addMember: call(IpcChannel.tagsAddMember),
    addMembers: call(IpcChannel.tagsAddMembers),
    removeMember: call(IpcChannel.tagsRemoveMember),
  },
  sde: {
    status: call(IpcChannel.sdeStatus),
    import: call(IpcChannel.sdeImport),
    checkUpdate: call(IpcChannel.sdeCheckUpdate),
    dismissUpdate: call(IpcChannel.sdeDismissUpdate),
    onProgress: subscribe<SdeProgress>(IpcChannel.sdeProgress),
  },
  fits: {
    list: call(IpcChannel.fitsList),
    import: call(IpcChannel.fitsImport),
    remove: call(IpcChannel.fitsRemove),
    analyze: call(IpcChannel.fitsAnalyze),
  },
  plans: {
    list: call(IpcChannel.plansList),
    import: call(IpcChannel.plansImport),
    update: call(IpcChannel.plansUpdate),
    remove: call(IpcChannel.plansRemove),
    setSheetVisibility: call(IpcChannel.plansSetSheetVisibility),
    analyze: call(IpcChannel.plansAnalyze),
    skillCatalog: call(IpcChannel.plansSkillCatalog),
    shipCatalog: call(IpcChannel.plansShipCatalog),
    draft: call(IpcChannel.plansDraft),
    draftFromFit: call(IpcChannel.plansDraftFromFit),
    draftFromEft: call(IpcChannel.plansDraftFromEft),
  },
  location: {
    board: call(IpcChannel.locationBoard),
    nearest: call(IpcChannel.locationNearest),
  },
  structures: {
    importPublic: call(IpcChannel.structuresImport),
    onImportProgress: subscribe<StructureImportProgress>(IpcChannel.structuresImportProgress),
    search: call(IpcChannel.structuresSearch),
  },
  systems: {
    search: call(IpcChannel.systemsSearch),
  },
  clones: {
    board: call(IpcChannel.clonesBoard),
  },
  blueprints: {
    board: call(IpcChannel.blueprintsBoard),
    refresh: call(IpcChannel.blueprintsRefresh),
    addCorp: call(IpcChannel.blueprintsAddCorp),
    removeCorp: call(IpcChannel.blueprintsRemoveCorp),
  },
  dashboard: {
    summary: call(IpcChannel.dashboardSummary),
  },
  wallet: {
    summary: call(IpcChannel.walletSummary),
  },
  notifications: {
    list: call(IpcChannel.notificationsList),
    markRead: call(IpcChannel.notificationsMarkRead),
    markAllRead: call(IpcChannel.notificationsMarkAllRead),
    onChanged: subscribe(IpcChannel.notificationsChanged),
  },
  system: {
    isClientConfigured: call(IpcChannel.systemClientConfigured),
    appInfo: call(IpcChannel.systemAppInfo),
    confirm: call(IpcChannel.systemConfirm),
    copyText: call(IpcChannel.systemCopyText),
    checkUpdate: call(IpcChannel.systemCheckUpdate),
    dismissUpdate: call(IpcChannel.systemDismissUpdate),
    downloadUpdate: call(IpcChannel.systemDownloadUpdate),
    installUpdate: call(IpcChannel.systemInstallUpdate),
    setAutoCheckUpdate: call(IpcChannel.systemSetAutoCheckUpdate),
    onUpdateProgress: subscribe(IpcChannel.updateProgress),
  },
  settings: {
    syncStatus: call(IpcChannel.settingsSyncStatus),
    esiActivity: call(IpcChannel.settingsEsiActivity),
    exportLogs: call(IpcChannel.settingsExportLogs),
    exportBackup: call(IpcChannel.settingsExportBackup),
    openDataFolder: call(IpcChannel.settingsOpenDataFolder),
    backgroundMode: call(IpcChannel.settingsBackgroundMode),
    setCloseToTray: call(IpcChannel.settingsSetCloseToTray),
    runInBackground: call(IpcChannel.settingsRunInBackground),
  },
};

contextBridge.exposeInMainWorld('mco', api);
