import { describe, expect, it } from 'vitest';
import {
  findIdleOmegaAccounts,
  type OmegaAccountCandidate,
} from '@main/notifications/idleOmega';

function candidate(overrides: Partial<OmegaAccountCandidate>): OmegaAccountCandidate {
  return {
    accountId: 1,
    accountLabel: 'Account One',
    isOmega: true,
    characterCount: 3,
    trainingCount: 0,
    ...overrides,
  };
}

describe('findIdleOmegaAccounts', () => {
  it('warns when an Omega account has characters and none is training', () => {
    expect(findIdleOmegaAccounts([candidate({})])).toEqual([
      { accountId: 1, accountLabel: 'Account One', characterCount: 3 },
    ]);
  });

  it('does not warn when one character on the account is training', () => {
    expect(findIdleOmegaAccounts([candidate({ trainingCount: 1 })])).toHaveLength(0);
  });

  it('does not warn for an idle Alpha account', () => {
    expect(findIdleOmegaAccounts([candidate({ isOmega: false })])).toHaveLength(0);
  });

  it('does not warn for an Omega account with no characters assigned', () => {
    expect(findIdleOmegaAccounts([candidate({ characterCount: 0 })])).toHaveLength(0);
  });

  it('warns for a single-character Omega account that is idle', () => {
    const warnings = findIdleOmegaAccounts([candidate({ characterCount: 1 })]);
    expect(warnings).toEqual([
      { accountId: 1, accountLabel: 'Account One', characterCount: 1 },
    ]);
  });

  it('returns an empty array for no candidates', () => {
    expect(findIdleOmegaAccounts([])).toEqual([]);
  });

  it('returns exactly the idle Omega subset among mixed accounts', () => {
    const warnings = findIdleOmegaAccounts([
      candidate({ accountId: 1, accountLabel: 'Idle Omega' }),
      candidate({ accountId: 2, accountLabel: 'Busy Omega', trainingCount: 2 }),
      candidate({ accountId: 3, accountLabel: 'Idle Alpha', isOmega: false }),
      candidate({ accountId: 4, accountLabel: 'Empty Omega', characterCount: 0 }),
      candidate({ accountId: 5, accountLabel: 'Also Idle', characterCount: 2 }),
    ]);
    expect(warnings).toEqual([
      { accountId: 1, accountLabel: 'Idle Omega', characterCount: 3 },
      { accountId: 5, accountLabel: 'Also Idle', characterCount: 2 },
    ]);
  });
});
