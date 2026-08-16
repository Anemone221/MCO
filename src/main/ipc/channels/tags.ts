import { IpcChannel } from '@shared/ipc';
import {
  addTagToCharacter,
  addTagToCharacters,
  createTag,
  listTags,
  removeTag,
  removeTagFromCharacter,
  renameTag,
  setTagColor,
} from '../../db/repositories/tags';
import { handle } from '../handle';

export function registerTagChannels(): void {
  handle(IpcChannel.tagsList, () => listTags());
  handle(IpcChannel.tagsCreate, (_event, name: string, color: string | null) =>
    createTag(name, color),
  );
  handle(IpcChannel.tagsRename, (_event, id: number, name: string) => renameTag(id, name));
  handle(IpcChannel.tagsSetColor, (_event, id: number, color: string | null) =>
    setTagColor(id, color),
  );
  handle(IpcChannel.tagsRemove, (_event, id: number) => removeTag(id));
  handle(IpcChannel.tagsAddMember, (_event, tagId: number, characterId: number) =>
    addTagToCharacter(tagId, characterId),
  );
  handle(IpcChannel.tagsAddMembers, (_event, tagId: number, characterIds: number[]) =>
    addTagToCharacters(tagId, characterIds),
  );
  handle(IpcChannel.tagsRemoveMember, (_event, tagId: number, characterId: number) =>
    removeTagFromCharacter(tagId, characterId),
  );
}
