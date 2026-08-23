import { IpcChannel } from '@shared/ipc';
import { buildLocationBoard } from '../../services/locationService';
import { buildNearestBoard } from '../../services/proximityService';
import { buildCloneBoard } from '../../services/cloneService';
import { buildDashboardSummary } from '../../services/dashboardService';
import { buildWalletSummary } from '../../services/walletService';
import { buildMiningSummary } from '../../services/miningService';
import { handle } from '../handle';

/**
 * Pages whose entire IPC surface is reading a board: they share a file rather
 * than taking one each. When a board grows a mutation — a filter the main
 * process has to persist, an action on a row — give it its own module and move
 * its reads across with it.
 */
export function registerBoardChannels(): void {
  handle(IpcChannel.locationBoard, () => buildLocationBoard());
  handle(
    IpcChannel.locationNearest,
    (_event, solarSystemId: number, includeJumpClones: boolean | null) =>
      buildNearestBoard(solarSystemId, includeJumpClones === true),
  );
  handle(IpcChannel.clonesBoard, () => buildCloneBoard());
  handle(IpcChannel.dashboardSummary, () => buildDashboardSummary());
  handle(IpcChannel.walletSummary, () => buildWalletSummary());
  handle(IpcChannel.miningSummary, (_event, days: number | null) => buildMiningSummary(days));
}
