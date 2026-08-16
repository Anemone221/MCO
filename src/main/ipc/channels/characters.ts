import { IpcChannel } from '@shared/ipc';
import { startLogin } from '../../auth/esi-oauth';
import { assignAccount, removeCharacter } from '../../db/repositories/characters';
import { buildRoster, syncAllCharacters, syncCharacter } from '../../services/characterSync';
import { buildCharacterDetail } from '../../services/characterDetail';
import { handle } from '../handle';

export function registerCharacterChannels(): void {
  handle(IpcChannel.charactersRoster, () => buildRoster());
  handle(IpcChannel.charactersAdd, async () => {
    const character = await startLogin();
    try {
      await syncCharacter(character.id);
    } catch (err) {
      console.warn('Initial sync after add failed; the scheduler will retry:', err);
    }
    return character;
  });
  handle(IpcChannel.charactersRemove, (_event, id: number) => removeCharacter(id));
  handle(IpcChannel.charactersSync, (_event, id: number) => syncCharacter(id));
  handle(IpcChannel.charactersSyncAll, () => syncAllCharacters());
  handle(IpcChannel.charactersAssignAccount, (_event, id: number, accountId: number | null) =>
    assignAccount(id, accountId),
  );
  handle(IpcChannel.charactersDetail, (_event, id: number) => buildCharacterDetail(id));
}
