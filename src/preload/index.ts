import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IpcChannel, type McoApi } from '@shared/ipc';
import type { SdeProgress, StructureImportProgress } from '@shared/types';

const api: McoApi = {
  characters: {
    roster: () => ipcRenderer.invoke(IpcChannel.charactersRoster),
    add: () => ipcRenderer.invoke(IpcChannel.charactersAdd),
    remove: (characterId) => ipcRenderer.invoke(IpcChannel.charactersRemove, characterId),
    sync: (characterId) => ipcRenderer.invoke(IpcChannel.charactersSync, characterId),
    syncAll: () => ipcRenderer.invoke(IpcChannel.charactersSyncAll),
    assignAccount: (characterId, accountId) =>
      ipcRenderer.invoke(IpcChannel.charactersAssignAccount, characterId, accountId),
    detail: (characterId) => ipcRenderer.invoke(IpcChannel.charactersDetail, characterId),
    onChanged: (callback) => {
      const listener = (): void => callback();
      ipcRenderer.on(IpcChannel.charactersChanged, listener);
      return () => ipcRenderer.removeListener(IpcChannel.charactersChanged, listener);
    },
  },
  accounts: {
    list: () => ipcRenderer.invoke(IpcChannel.accountsList),
    create: (label, color) => ipcRenderer.invoke(IpcChannel.accountsCreate, label, color ?? null),
    rename: (accountId, label) => ipcRenderer.invoke(IpcChannel.accountsRename, accountId, label),
    setOmega: (accountId, isOmega) =>
      ipcRenderer.invoke(IpcChannel.accountsSetOmega, accountId, isOmega),
    remove: (accountId) => ipcRenderer.invoke(IpcChannel.accountsRemove, accountId),
  },
  groups: {
    list: () => ipcRenderer.invoke(IpcChannel.groupsList),
    detail: (groupId) => ipcRenderer.invoke(IpcChannel.groupsDetail, groupId),
    create: (name, color) => ipcRenderer.invoke(IpcChannel.groupsCreate, name, color ?? null),
    rename: (groupId, name) => ipcRenderer.invoke(IpcChannel.groupsRename, groupId, name),
    setPriorityFit: (groupId, fitId) =>
      ipcRenderer.invoke(IpcChannel.groupsSetPriorityFit, groupId, fitId),
    setPriorityPlan: (groupId, planId) =>
      ipcRenderer.invoke(IpcChannel.groupsSetPriorityPlan, groupId, planId),
    setHomeStation: (groupId, station) =>
      ipcRenderer.invoke(IpcChannel.groupsSetHomeStation, groupId, station),
    addPodSystem: (groupId, system) =>
      ipcRenderer.invoke(IpcChannel.groupsAddPodSystem, groupId, system),
    removePodSystem: (groupId, solarSystemId) =>
      ipcRenderer.invoke(IpcChannel.groupsRemovePodSystem, groupId, solarSystemId),
    ignorePod: (groupId, characterId, jumpCloneId) =>
      ipcRenderer.invoke(IpcChannel.groupsIgnorePod, groupId, characterId, jumpCloneId),
    unignorePod: (groupId, characterId, jumpCloneId) =>
      ipcRenderer.invoke(IpcChannel.groupsUnignorePod, groupId, characterId, jumpCloneId),
    remove: (groupId) => ipcRenderer.invoke(IpcChannel.groupsRemove, groupId),
    addMember: (groupId, characterId) =>
      ipcRenderer.invoke(IpcChannel.groupsAddMember, groupId, characterId),
    removeMember: (groupId, characterId) =>
      ipcRenderer.invoke(IpcChannel.groupsRemoveMember, groupId, characterId),
  },
  tags: {
    list: () => ipcRenderer.invoke(IpcChannel.tagsList),
    create: (name, color) => ipcRenderer.invoke(IpcChannel.tagsCreate, name, color ?? null),
    rename: (tagId, name) => ipcRenderer.invoke(IpcChannel.tagsRename, tagId, name),
    setColor: (tagId, color) => ipcRenderer.invoke(IpcChannel.tagsSetColor, tagId, color ?? null),
    remove: (tagId) => ipcRenderer.invoke(IpcChannel.tagsRemove, tagId),
    addMember: (tagId, characterId) =>
      ipcRenderer.invoke(IpcChannel.tagsAddMember, tagId, characterId),
    addMembers: (tagId, characterIds) =>
      ipcRenderer.invoke(IpcChannel.tagsAddMembers, tagId, characterIds),
    removeMember: (tagId, characterId) =>
      ipcRenderer.invoke(IpcChannel.tagsRemoveMember, tagId, characterId),
  },
  sde: {
    status: () => ipcRenderer.invoke(IpcChannel.sdeStatus),
    import: () => ipcRenderer.invoke(IpcChannel.sdeImport),
    onProgress: (callback) => {
      const listener = (_event: IpcRendererEvent, progress: SdeProgress): void =>
        callback(progress);
      ipcRenderer.on(IpcChannel.sdeProgress, listener);
      return () => ipcRenderer.removeListener(IpcChannel.sdeProgress, listener);
    },
  },
  fits: {
    list: () => ipcRenderer.invoke(IpcChannel.fitsList),
    import: (eftText) => ipcRenderer.invoke(IpcChannel.fitsImport, eftText),
    remove: (fitId) => ipcRenderer.invoke(IpcChannel.fitsRemove, fitId),
    analyze: (fitId) => ipcRenderer.invoke(IpcChannel.fitsAnalyze, fitId),
  },
  plans: {
    list: () => ipcRenderer.invoke(IpcChannel.plansList),
    import: (name, planText) => ipcRenderer.invoke(IpcChannel.plansImport, name, planText),
    remove: (planId) => ipcRenderer.invoke(IpcChannel.plansRemove, planId),
    analyze: (planId) => ipcRenderer.invoke(IpcChannel.plansAnalyze, planId),
  },
  location: {
    board: () => ipcRenderer.invoke(IpcChannel.locationBoard),
  },
  structures: {
    importPublic: () => ipcRenderer.invoke(IpcChannel.structuresImport),
    onImportProgress: (callback) => {
      const listener = (_event: IpcRendererEvent, progress: StructureImportProgress): void =>
        callback(progress);
      ipcRenderer.on(IpcChannel.structuresImportProgress, listener);
      return () => ipcRenderer.removeListener(IpcChannel.structuresImportProgress, listener);
    },
    search: (query) => ipcRenderer.invoke(IpcChannel.structuresSearch, query),
  },
  systems: {
    search: (query) => ipcRenderer.invoke(IpcChannel.systemsSearch, query),
  },
  clones: {
    board: () => ipcRenderer.invoke(IpcChannel.clonesBoard),
  },
  dashboard: {
    summary: () => ipcRenderer.invoke(IpcChannel.dashboardSummary),
  },
  wallet: {
    summary: () => ipcRenderer.invoke(IpcChannel.walletSummary),
  },
  notifications: {
    list: () => ipcRenderer.invoke(IpcChannel.notificationsList),
    markRead: (id) => ipcRenderer.invoke(IpcChannel.notificationsMarkRead, id),
    markAllRead: () => ipcRenderer.invoke(IpcChannel.notificationsMarkAllRead),
    onChanged: (callback) => {
      const listener = (): void => callback();
      ipcRenderer.on(IpcChannel.notificationsChanged, listener);
      return () => ipcRenderer.removeListener(IpcChannel.notificationsChanged, listener);
    },
  },
  system: {
    isClientConfigured: () => ipcRenderer.invoke(IpcChannel.systemClientConfigured),
    appInfo: () => ipcRenderer.invoke(IpcChannel.systemAppInfo),
    confirm: (message, confirmLabel) =>
      ipcRenderer.invoke(IpcChannel.systemConfirm, message, confirmLabel ?? null),
  },
  settings: {
    syncStatus: () => ipcRenderer.invoke(IpcChannel.settingsSyncStatus),
    esiActivity: () => ipcRenderer.invoke(IpcChannel.settingsEsiActivity),
    exportLogs: () => ipcRenderer.invoke(IpcChannel.settingsExportLogs),
    exportBackup: () => ipcRenderer.invoke(IpcChannel.settingsExportBackup),
    openDataFolder: () => ipcRenderer.invoke(IpcChannel.settingsOpenDataFolder),
  },
};

contextBridge.exposeInMainWorld('mco', api);
