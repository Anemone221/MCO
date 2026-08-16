import { IpcChannel } from '@shared/ipc';
import { listFits, removeFit } from '../../db/repositories/fits';
import { analyzeFitById, importFit } from '../../services/fitService';
import { handle } from '../handle';

export function registerFitChannels(): void {
  handle(IpcChannel.fitsList, () => listFits());
  handle(IpcChannel.fitsImport, (_event, eftText: string) => importFit(eftText));
  handle(IpcChannel.fitsRemove, (_event, fitId: number) => removeFit(fitId));
  handle(IpcChannel.fitsAnalyze, (_event, fitId: number) => analyzeFitById(fitId));
}
