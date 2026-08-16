import { IpcChannel } from '@shared/ipc';
import {
  addGroupPodIgnore,
  addGroupPodSystem,
  addMember,
  createGroup,
  listGroups,
  removeGroup,
  removeGroupPodIgnore,
  removeGroupPodSystem,
  removeMember,
  renameGroup,
  setGroupHomeStation,
  setGroupPriorityFit,
  setGroupPriorityPlan,
} from '../../db/repositories/groups';
import { buildGroupDetail } from '../../services/groupService';
import { handle } from '../handle';

export function registerGroupChannels(): void {
  handle(IpcChannel.groupsList, () => listGroups());
  handle(IpcChannel.groupsDetail, (_event, id: number) => buildGroupDetail(id));
  handle(IpcChannel.groupsCreate, (_event, name: string, color: string | null) =>
    createGroup(name, color),
  );
  handle(IpcChannel.groupsRename, (_event, id: number, name: string) => renameGroup(id, name));
  handle(IpcChannel.groupsSetPriorityFit, (_event, id: number, fitId: number | null) =>
    setGroupPriorityFit(id, fitId),
  );
  handle(IpcChannel.groupsSetPriorityPlan, (_event, id: number, planId: number | null) =>
    setGroupPriorityPlan(id, planId),
  );
  handle(
    IpcChannel.groupsSetHomeStation,
    (_event, id: number, station: { id: number; name: string } | null) =>
      setGroupHomeStation(id, station),
  );
  handle(
    IpcChannel.groupsAddPodSystem,
    (_event, id: number, system: { id: number; name: string }) => addGroupPodSystem(id, system),
  );
  handle(IpcChannel.groupsRemovePodSystem, (_event, id: number, solarSystemId: number) =>
    removeGroupPodSystem(id, solarSystemId),
  );
  handle(
    IpcChannel.groupsIgnorePod,
    (_event, id: number, characterId: number, jumpCloneId: number | null) =>
      addGroupPodIgnore(id, characterId, jumpCloneId),
  );
  handle(
    IpcChannel.groupsUnignorePod,
    (_event, id: number, characterId: number, jumpCloneId: number | null) =>
      removeGroupPodIgnore(id, characterId, jumpCloneId),
  );
  handle(IpcChannel.groupsRemove, (_event, id: number) => removeGroup(id));
  handle(IpcChannel.groupsAddMember, (_event, groupId: number, characterId: number) =>
    addMember(groupId, characterId),
  );
  handle(IpcChannel.groupsRemoveMember, (_event, groupId: number, characterId: number) =>
    removeMember(groupId, characterId),
  );
}
