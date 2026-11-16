import type { BrowserWindow } from 'electron';
import { IpcChannel } from '@shared/ipc';
import { cancelLogin } from '../../auth/esi-oauth';
import {
  assignAccount,
  assignAccountToCharacters,
  removeCharacter,
} from '../../db/repositories/characters';
import {
  buildRoster,
  setSyncProgressListener,
  syncAllCharacters,
  syncCharacter,
  syncCharacters,
} from '../../services/characterSync';
import { buildCharacterDetail } from '../../services/characterDetail';
import { addCharacter, reauthorizeCharacter } from '../../services/loginService';
import { handle } from '../handle';

export function registerCharacterChannels(getWindow: () => BrowserWindow | null): void {
  // Every multi-character sync reports through here, whoever started it —
  // "Sync all", the hourly sweep, the tray — so the renderer's indicator needs
  // no knowledge of which one is running.
  setSyncProgressListener((progress) => {
    getWindow()?.webContents.send(IpcChannel.charactersSyncProgress, progress);
  });

  handle(IpcChannel.charactersRoster, () => buildRoster());
  // A sign-in whose first sync was left running tells the window when that
  // sync lands, the same way a background sweep does.
  const onSynced = (): void => {
    getWindow()?.webContents.send(IpcChannel.charactersChanged);
  };

  handle(IpcChannel.charactersAdd, (_event, deferSync: boolean | null) =>
    addCharacter({ deferSync: deferSync === true, onSynced }),
  );
  handle(IpcChannel.charactersReauthorize, (_event, id: number) =>
    reauthorizeCharacter(id, { deferSync: true, onSynced }),
  );
  handle(IpcChannel.charactersCancelLogin, () => cancelLogin());
  handle(IpcChannel.charactersRemove, (_event, id: number) => removeCharacter(id));
  handle(IpcChannel.charactersSync, (_event, id: number) => syncCharacter(id));
  handle(IpcChannel.charactersSyncAll, () => syncAllCharacters());
  handle(IpcChannel.charactersAssignAccount, (_event, id: number, accountId: number | null) =>
    assignAccount(id, accountId),
  );
  handle(IpcChannel.charactersSyncMany, (_event, ids: number[]) => syncCharacters(ids));
  handle(
    IpcChannel.charactersAssignAccounts,
    (_event, ids: number[], accountId: number | null) => assignAccountToCharacters(ids, accountId),
  );
  handle(IpcChannel.charactersDetail, (_event, id: number) => buildCharacterDetail(id));
}
