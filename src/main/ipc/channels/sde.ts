import type { BrowserWindow } from 'electron';
import { IpcChannel } from '@shared/ipc';
import { getSdeStatus } from '../../db/repositories/sde';
import { runSdeImport } from '../../services/sdeService';
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
}
