import { ipcMain, type BrowserWindow } from 'electron';
import { IpcChannel } from '@shared/ipc';
import { isClientIdConfigured } from '../config';
import { startLogin } from '../auth/esi-oauth';
import { assignAccount, removeCharacter } from '../db/repositories/characters';
import {
  createAccount,
  listAccounts,
  removeAccount,
  renameAccount,
} from '../db/repositories/accounts';
import { getSdeStatus } from '../db/repositories/sde';
import { listFits, removeFit } from '../db/repositories/fits';
import { listPlans, removePlan } from '../db/repositories/plans';
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
  ipcMain.handle(IpcChannel.accountsRemove, (_event, id: number) => removeAccount(id));

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

  ipcMain.handle(IpcChannel.systemClientConfigured, () => isClientIdConfigured());
}
