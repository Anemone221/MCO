import type { BrowserWindow } from 'electron';
import { IpcChannel } from '@shared/ipc';
import { searchSystemsByName } from '../../db/repositories/sde';
import { importPublicStructures, searchStructures } from '../../services/structureService';
import { handle } from '../handle';

/**
 * Universe lookups: the structure/system searches behind the group home-station
 * and pod-whitelist pickers, plus the public-structure import that fills them.
 */
export function registerUniverseChannels(getWindow: () => BrowserWindow | null): void {
  handle(IpcChannel.structuresImport, () =>
    importPublicStructures((progress) => {
      getWindow()?.webContents.send(IpcChannel.structuresImportProgress, progress);
    }),
  );
  handle(IpcChannel.structuresSearch, (_event, query: string) => searchStructures(query));
  handle(IpcChannel.systemsSearch, (_event, query: string) => searchSystemsByName(query));
}
