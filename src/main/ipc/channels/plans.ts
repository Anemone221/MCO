import { IpcChannel } from '@shared/ipc';
import { listPlans, removePlan } from '../../db/repositories/plans';
import {
  analyzePlanById,
  importPlan,
  setPlanSheetVisibilityById,
  updatePlanById,
} from '../../services/planService';
import {
  eftDraft,
  fitDraft,
  planDraft,
  shipCatalog,
  skillCatalog,
} from '../../services/planBuilderService';
import { handle } from '../handle';

export function registerPlanChannels(): void {
  handle(IpcChannel.plansList, () => listPlans());
  handle(IpcChannel.plansImport, (_event, name: string, planText: string) =>
    importPlan(name, planText),
  );
  handle(IpcChannel.plansUpdate, (_event, planId: number, name: string, planText: string) =>
    updatePlanById(planId, name, planText),
  );
  handle(IpcChannel.plansRemove, (_event, planId: number) => removePlan(planId));
  handle(IpcChannel.plansSetSheetVisibility, (_event, planId: number, show: boolean) =>
    setPlanSheetVisibilityById(planId, show),
  );
  handle(IpcChannel.plansAnalyze, (_event, planId: number) => analyzePlanById(planId));

  // The creator's own channels: the skill catalogue it browses, and the three
  // things a draft can start from.
  handle(IpcChannel.plansSkillCatalog, () => skillCatalog());
  handle(IpcChannel.plansShipCatalog, () => shipCatalog());
  handle(IpcChannel.plansDraft, (_event, planId: number) => planDraft(planId));
  handle(IpcChannel.plansDraftFromFit, (_event, fitId: number) => fitDraft(fitId));
  handle(IpcChannel.plansDraftFromEft, (_event, eftText: string) => eftDraft(eftText));
}
