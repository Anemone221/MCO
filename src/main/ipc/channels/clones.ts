import { IpcChannel } from '@shared/ipc';
import { buildCloneBoard, setCriticalImplantSet } from '../../services/cloneService';
import { handle } from '../handle';

export function registerCloneChannels(): void {
  handle(IpcChannel.clonesBoard, () => buildCloneBoard());
  handle(
    IpcChannel.clonesSetCritical,
    (
      _event,
      characterId: number,
      implantTypeIds: number[],
      critical: boolean,
      label: string | null,
    ) => setCriticalImplantSet(characterId, implantTypeIds, critical, label),
  );
}
