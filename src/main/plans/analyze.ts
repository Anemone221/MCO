import type { PlanCharacterResult } from '@shared/types';
import { analyzeFit, type FitAnalysisInput } from '../fits/analyze';

export type PlanAnalysisInput = FitAnalysisInput;

/** Analyse a skill plan across the whole character roster. */
export function analyzePlan(input: PlanAnalysisInput): PlanCharacterResult[] {
  return analyzeFit(input).map(({ canFly, ...rest }) => ({ ...rest, complete: canFly }));
}
