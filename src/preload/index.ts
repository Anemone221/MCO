import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IpcChannel, type McoApi } from '@shared/ipc';
import type { SdeProgress } from '@shared/types';

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
    remove: (accountId) => ipcRenderer.invoke(IpcChannel.accountsRemove, accountId),
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
  location: {
    board: () => ipcRenderer.invoke(IpcChannel.locationBoard),
  },
  system: {
    isClientConfigured: () => ipcRenderer.invoke(IpcChannel.systemClientConfigured),
  },
};

contextBridge.exposeInMainWorld('mco', api);
