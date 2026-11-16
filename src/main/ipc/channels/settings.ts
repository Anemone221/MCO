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
import { listBackups, restoreBackup } from '../../services/backupService';
import { stopScheduler } from '../../services/scheduler';
import { isLiveTrackingEnabled, setLiveTrackingEnabled } from '../../services/liveTracking';
import { handle } from '../handle';

export function registerSettingsChannels(getWindow: () => BrowserWindow | null): void {
  handle(IpcChannel.settingsSyncStatus, () => buildSyncStatus());
  handle(IpcChannel.settingsEsiActivity, () => getEsiActivity());
  // The window is the save dialog's parent, so it is read per call rather than
  // captured: in tray-only mode there may not be one.
  handle(IpcChannel.settingsExportLogs, () => exportLogs(getWindow()));
  handle(IpcChannel.settingsExportBackup, () => exportBackup(getWindow()));
  handle(IpcChannel.settingsBackups, () => listBackups());
  handle(IpcChannel.settingsRestoreBackup, (_event, fileName: string) =>
    restoreBackup(fileName, stopScheduler),
  );
  handle(IpcChannel.settingsOpenDataFolder, () => openDataFolder());
  handle(IpcChannel.settingsBackgroundMode, () => getBackgroundModeSettings());
  handle(IpcChannel.settingsSetCloseToTray, (_event, enabled: boolean) => setCloseToTray(enabled));
  handle(IpcChannel.settingsRunInBackground, () => enterBackgroundNow());
  handle(IpcChannel.settingsLiveTracking, () => isLiveTrackingEnabled());
  handle(IpcChannel.settingsSetLiveTracking, (_event, enabled: boolean) =>
    setLiveTrackingEnabled(enabled),
  );
}
