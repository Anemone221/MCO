import type { BrowserWindow } from 'electron';
import { IpcChannel } from '@shared/ipc';
import { getSdeStatus } from '../../db/repositories/sde';
import { runSdeImport } from '../../services/sdeService';
import { checkSdeUpdate, dismissSdeUpdate } from '../../services/sdeUpdateService';
import { handle } from '../handle';

export function registerSdeChannels(getWindow: () => BrowserWindow | null): void {
  handle(IpcChannel.sdeStatus, () => getSdeStatus());
  // Import reports progress as it runs, so it pushes on sdeProgress rather than
  // making the renderer poll.
  handle(IpcChannel.sdeImport, () =>
    runSdeImport((progress) => {
      getWindow()?.webContents.send(IpcChannel.sdeProgress, progress);
    }),
  );
  // Whether CCP published a newer build. Answers off a daily cache unless the
  // caller forces it, and never rejects — see `services/sdeUpdateService.ts`.
  handle(IpcChannel.sdeCheckUpdate, (_event, force?: boolean) => checkSdeUpdate(force ?? false));
  handle(IpcChannel.sdeDismissUpdate, (_event, build: string) => dismissSdeUpdate(build));
}
