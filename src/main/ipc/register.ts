import { dialog, ipcMain, type BrowserWindow } from 'electron';
import { IpcChannel } from '@shared/ipc';
import { isClientIdConfigured } from '../config';
import { startLogin } from '../auth/esi-oauth';
import { assignAccount, removeCharacter } from '../db/repositories/characters';
import {
  createAccount,
  listAccounts,
  removeAccount,
  renameAccount,
  setAccountOmega,
} from '../db/repositories/accounts';
import {
  addGroupPodIgnore,
  addGroupPodSystem,
  addMember,
  createGroup,
  listGroups,
  removeGroup,
  removeGroupPodIgnore,
  removeGroupPodSystem,
  removeMember,
  renameGroup,
  setGroupHomeStation,
  setGroupPriorityFit,
  setGroupPriorityPlan,
} from '../db/repositories/groups';
import {
  addTagToCharacter,
  addTagToCharacters,
  createTag,
  listTags,
  removeTag,
  removeTagFromCharacter,
  renameTag,
  setTagColor,
} from '../db/repositories/tags';
import { getSdeStatus, searchSystemsByName } from '../db/repositories/sde';
import { listFits, removeFit } from '../db/repositories/fits';
import { listPlans, removePlan } from '../db/repositories/plans';
import {
  listNotifications,
  markAllRead,
  markRead,
} from '../db/repositories/notifications';
import {
  buildRoster,
  syncAllCharacters,
  syncCharacter,
} from '../services/characterSync';
import { buildCharacterDetail } from '../services/characterDetail';
import { runSdeImport } from '../services/sdeService';
import { analyzeFitById, importFit } from '../services/fitService';
import { analyzePlanById, importPlan } from '../services/planService';
import { buildLocationBoard } from '../services/locationService';
import { importPublicStructures, searchStructures } from '../services/structureService';
import { buildCloneBoard } from '../services/cloneService';
import { buildGroupDetail } from '../services/groupService';
import { buildDashboardSummary } from '../services/dashboardService';
import { getEsiActivity } from '../esi/esiLog';
import { buildWalletSummary } from '../services/walletService';
import {
  buildSyncStatus,
  exportBackup,
  exportLogs,
  getAppInfo,
  openDataFolder,
} from '../services/settingsService';

/** Wire every renderer-facing IPC channel to its main-process handler. */
export function registerIpc(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle(IpcChannel.charactersRoster, () => buildRoster());
  ipcMain.handle(IpcChannel.charactersAdd, async () => {
    const character = await startLogin();
    try {
      await syncCharacter(character.id);
    } catch (err) {
      console.warn('Initial sync after add failed; the scheduler will retry:', err);
    }
    return character;
  });
  ipcMain.handle(IpcChannel.charactersRemove, (_event, id: number) => removeCharacter(id));
  ipcMain.handle(IpcChannel.charactersSync, (_event, id: number) => syncCharacter(id));
  ipcMain.handle(IpcChannel.charactersSyncAll, () => syncAllCharacters());
  ipcMain.handle(
    IpcChannel.charactersAssignAccount,
    (_event, id: number, accountId: number | null) => assignAccount(id, accountId),
  );
  ipcMain.handle(IpcChannel.charactersDetail, (_event, id: number) => buildCharacterDetail(id));

  ipcMain.handle(IpcChannel.accountsList, () => listAccounts());
  ipcMain.handle(IpcChannel.accountsCreate, (_event, label: string, color: string | null) =>
    createAccount(label, color),
  );
  ipcMain.handle(IpcChannel.accountsRename, (_event, id: number, label: string) =>
    renameAccount(id, label),
  );
  ipcMain.handle(IpcChannel.accountsSetOmega, (_event, id: number, isOmega: boolean) =>
    setAccountOmega(id, isOmega),
  );
  ipcMain.handle(IpcChannel.accountsRemove, (_event, id: number) => removeAccount(id));

  ipcMain.handle(IpcChannel.groupsList, () => listGroups());
  ipcMain.handle(IpcChannel.groupsDetail, (_event, id: number) => buildGroupDetail(id));
  ipcMain.handle(IpcChannel.groupsCreate, (_event, name: string, color: string | null) =>
    createGroup(name, color),
  );
  ipcMain.handle(IpcChannel.groupsRename, (_event, id: number, name: string) =>
    renameGroup(id, name),
  );
  ipcMain.handle(IpcChannel.groupsSetPriorityFit, (_event, id: number, fitId: number | null) =>
    setGroupPriorityFit(id, fitId),
  );
  ipcMain.handle(IpcChannel.groupsSetPriorityPlan, (_event, id: number, planId: number | null) =>
    setGroupPriorityPlan(id, planId),
  );
  ipcMain.handle(
    IpcChannel.groupsSetHomeStation,
    (_event, id: number, station: { id: number; name: string } | null) =>
      setGroupHomeStation(id, station),
  );
  ipcMain.handle(
    IpcChannel.groupsAddPodSystem,
    (_event, id: number, system: { id: number; name: string }) => addGroupPodSystem(id, system),
  );
  ipcMain.handle(
    IpcChannel.groupsRemovePodSystem,
    (_event, id: number, solarSystemId: number) => removeGroupPodSystem(id, solarSystemId),
  );
  ipcMain.handle(
    IpcChannel.groupsIgnorePod,
    (_event, id: number, characterId: number, jumpCloneId: number | null) =>
      addGroupPodIgnore(id, characterId, jumpCloneId),
  );
  ipcMain.handle(
    IpcChannel.groupsUnignorePod,
    (_event, id: number, characterId: number, jumpCloneId: number | null) =>
      removeGroupPodIgnore(id, characterId, jumpCloneId),
  );
  ipcMain.handle(IpcChannel.groupsRemove, (_event, id: number) => removeGroup(id));
  ipcMain.handle(IpcChannel.groupsAddMember, (_event, groupId: number, characterId: number) =>
    addMember(groupId, characterId),
  );
  ipcMain.handle(
    IpcChannel.groupsRemoveMember,
    (_event, groupId: number, characterId: number) => removeMember(groupId, characterId),
  );

  ipcMain.handle(IpcChannel.tagsList, () => listTags());
  ipcMain.handle(IpcChannel.tagsCreate, (_event, name: string, color: string | null) =>
    createTag(name, color),
  );
  ipcMain.handle(IpcChannel.tagsRename, (_event, id: number, name: string) => renameTag(id, name));
  ipcMain.handle(IpcChannel.tagsSetColor, (_event, id: number, color: string | null) =>
    setTagColor(id, color),
  );
  ipcMain.handle(IpcChannel.tagsRemove, (_event, id: number) => removeTag(id));
  ipcMain.handle(IpcChannel.tagsAddMember, (_event, tagId: number, characterId: number) =>
    addTagToCharacter(tagId, characterId),
  );
  ipcMain.handle(IpcChannel.tagsAddMembers, (_event, tagId: number, characterIds: number[]) =>
    addTagToCharacters(tagId, characterIds),
  );
  ipcMain.handle(IpcChannel.tagsRemoveMember, (_event, tagId: number, characterId: number) =>
    removeTagFromCharacter(tagId, characterId),
  );

  ipcMain.handle(IpcChannel.sdeStatus, () => getSdeStatus());
  ipcMain.handle(IpcChannel.sdeImport, () =>
    runSdeImport((progress) => {
      getWindow()?.webContents.send(IpcChannel.sdeProgress, progress);
    }),
  );

  ipcMain.handle(IpcChannel.fitsList, () => listFits());
  ipcMain.handle(IpcChannel.fitsImport, (_event, eftText: string) => importFit(eftText));
  ipcMain.handle(IpcChannel.fitsRemove, (_event, fitId: number) => removeFit(fitId));
  ipcMain.handle(IpcChannel.fitsAnalyze, (_event, fitId: number) => analyzeFitById(fitId));

  ipcMain.handle(IpcChannel.plansList, () => listPlans());
  ipcMain.handle(IpcChannel.plansImport, (_event, name: string, planText: string) =>
    importPlan(name, planText),
  );
  ipcMain.handle(IpcChannel.plansRemove, (_event, planId: number) => removePlan(planId));
  ipcMain.handle(IpcChannel.plansAnalyze, (_event, planId: number) => analyzePlanById(planId));

  ipcMain.handle(IpcChannel.locationBoard, () => buildLocationBoard());

  ipcMain.handle(IpcChannel.structuresImport, () =>
    importPublicStructures((progress) => {
      getWindow()?.webContents.send(IpcChannel.structuresImportProgress, progress);
    }),
  );

  ipcMain.handle(IpcChannel.structuresSearch, (_event, query: string) =>
    searchStructures(query),
  );

  ipcMain.handle(IpcChannel.systemsSearch, (_event, query: string) =>
    searchSystemsByName(query),
  );

  ipcMain.handle(IpcChannel.clonesBoard, () => buildCloneBoard());

  ipcMain.handle(IpcChannel.dashboardSummary, () => buildDashboardSummary());
  ipcMain.handle(IpcChannel.walletSummary, () => buildWalletSummary());

  ipcMain.handle(IpcChannel.notificationsList, () => listNotifications());
  ipcMain.handle(IpcChannel.notificationsMarkRead, (_event, id: number) => markRead(id));
  ipcMain.handle(IpcChannel.notificationsMarkAllRead, () => markAllRead());

  ipcMain.handle(IpcChannel.systemClientConfigured, () => isClientIdConfigured());
  ipcMain.handle(IpcChannel.systemAppInfo, () => getAppInfo());
  ipcMain.handle(
    IpcChannel.systemConfirm,
    async (_event, message: string, confirmLabel: string | null) => {
      const win = getWindow();
      const options = {
        type: 'question' as const,
        buttons: [confirmLabel ?? 'OK', 'Cancel'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
        message,
      };
      const { response } = win
        ? await dialog.showMessageBox(win, options)
        : await dialog.showMessageBox(options);
      // Windows can leave the page unfocused after a native modal closes.
      win?.webContents.focus();
      return response === 0;
    },
  );

  ipcMain.handle(IpcChannel.settingsSyncStatus, () => buildSyncStatus());
  ipcMain.handle(IpcChannel.settingsEsiActivity, () => getEsiActivity());
  ipcMain.handle(IpcChannel.settingsExportLogs, () => exportLogs(getWindow()));
  ipcMain.handle(IpcChannel.settingsExportBackup, () => exportBackup(getWindow()));
  ipcMain.handle(IpcChannel.settingsOpenDataFolder, () => openDataFolder());
}
