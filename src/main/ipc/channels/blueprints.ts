import { IpcChannel } from '@shared/ipc';
import {
  addBlueprintCorp,
  buildBlueprintBoard,
  removeBlueprintCorporation,
  syncBlueprintCorps,
} from '../../services/blueprintService';
import { handle } from '../handle';

export function registerBlueprintChannels(): void {
  handle(IpcChannel.blueprintsBoard, () => buildBlueprintBoard());
  handle(IpcChannel.blueprintsRefresh, async () => {
    await syncBlueprintCorps({ force: true });
    return buildBlueprintBoard();
  });
  handle(IpcChannel.blueprintsAddCorp, async () => {
    await addBlueprintCorp();
    return buildBlueprintBoard();
  });
  handle(IpcChannel.blueprintsRemoveCorp, (_event, corporationId: number) =>
    removeBlueprintCorporation(corporationId),
  );
}
