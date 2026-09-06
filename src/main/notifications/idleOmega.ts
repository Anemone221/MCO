/**
 * One account as the idle-Omega rule sees it.
 *
 * `trainingCount` counts characters with a skill *actually* training — not
 * characters that merely have a queue. A paused queue trains nothing, and an
 * account whose queues are all paused is exactly the case worth warning about.
 */
export interface OmegaAccountCandidate {
  accountId: number;
  accountLabel: string;
  /** User-maintained Omega flag: ESI never reveals a subscription. */
  isOmega: boolean;
  /** Characters assigned to this account bucket. */
  characterCount: number;
  /** How many of them are training right now. */
  trainingCount: number;
}

export interface IdleOmegaWarning {
  accountId: number;
  accountLabel: string;
  characterCount: number;
}

/**
 * Omega accounts training nobody — subscription time paid for and not spent.
 *
 * An account with no characters assigned is not a warning. Assignment is
 * manual (ESI can't reveal account membership), so an empty bucket means "not
 * filled in yet", and warning about it would fire on every account the moment
 * it is created.
 *
 * Alpha accounts are skipped entirely: an idle Alpha costs nothing, and with
 * 90+ characters most accounts are idle most of the time — see `chip--idle`,
 * idle is routine here, not a fault.
 */
export function findIdleOmegaAccounts(candidates: OmegaAccountCandidate[]): IdleOmegaWarning[] {
  const warnings: IdleOmegaWarning[] = [];
  for (const candidate of candidates) {
    if (!candidate.isOmega) continue;
    if (candidate.characterCount <= 0) continue;
    if (candidate.trainingCount > 0) continue;
    warnings.push({
      accountId: candidate.accountId,
      accountLabel: candidate.accountLabel,
      characterCount: candidate.characterCount,
    });
  }
  return warnings;
}
