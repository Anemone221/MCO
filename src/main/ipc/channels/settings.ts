import type { BrowserWindow } from 'electron';
import { IpcChannel } from '@shared/ipc';
import { getEsiActivity } from '../../esi/esiLog';
import {
  buildSyncStatus,
  exportBackup,
  exportLogs,
  openDataFolder,
} from '../../services/settingsService';
import {
  enterBackgroundNow,
  getBackgroundModeSettings,
  setCloseToTray,
} from '../../services/backgroundMode';
import { handle } from '../handle';

export function registerSettingsChannels(getWindow: () => BrowserWindow | null): void {
  handle(IpcChannel.settingsSyncStatus, () => buildSyncStatus());
  handle(IpcChannel.settingsEsiActivity, () => getEsiActivity());
  // The window is the save dialog's parent, so it is read per call rather than
  // captured: in tray-only mode there may not be one.
  handle(IpcChannel.settingsExportLogs, () => exportLogs(getWindow()));
  handle(IpcChannel.settingsExportBackup, () => exportBackup(getWindow()));
  handle(IpcChannel.settingsOpenDataFolder, () => openDataFolder());
  handle(IpcChannel.settingsBackgroundMode, () => getBackgroundModeSettings());
  handle(IpcChannel.settingsSetCloseToTray, (_event, enabled: boolean) => setCloseToTray(enabled));
  handle(IpcChannel.settingsRunInBackground, () => enterBackgroundNow());
}
