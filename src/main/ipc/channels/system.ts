import { clipboard, dialog, type BrowserWindow } from 'electron';
import { IpcChannel } from '@shared/ipc';
import { isClientIdConfigured } from '../../config';
import { getAppInfo } from '../../services/settingsService';
import { checkForUpdate, dismissUpdate } from '../../services/updateService';
import { handle } from '../handle';

/** App-level facts and the one native dialog the renderer is allowed to raise. */
export function registerSystemChannels(getWindow: () => BrowserWindow | null): void {
  handle(IpcChannel.systemClientConfigured, () => isClientIdConfigured());
  handle(IpcChannel.systemAppInfo, () => getAppInfo());
  // Electron's clipboard rather than navigator.clipboard: the renderer is
  // sandboxed and a packaged build loads from file://, where the web API's
  // permission is not guaranteed.
  handle(IpcChannel.systemCopyText, (_event, text: string) => clipboard.writeText(text));
  // `force` crosses as null when the renderer omits it (see preload's `call`).
  handle(IpcChannel.systemCheckUpdate, (_event, force: boolean | null) =>
    checkForUpdate(force ?? false),
  );
  handle(IpcChannel.systemDismissUpdate, (_event, version: string) => dismissUpdate(version));
  handle(
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
}
