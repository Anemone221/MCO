import { describe, expect, it } from 'vitest';
import type { AccountBucket, RosterEntry } from '@shared/types';
import { buildAccountRows, idleOmegaAccounts } from '@renderer/lib/accountsView';

function account(id: number, label: string, isOmega = true): AccountBucket {
  return { id, label, color: null, isOmega };
}

function entry(id: number, accountId: number | null, isTraining = false): RosterEntry {
  return {
    character: {
      id,
      name: `Character ${id}`,
      corpId: null,
      allianceId: null,
      accountId,
      addedAt: '2026-01-01T00:00:00Z',
      refreshedAt: null,
    },
    accountLabel: null,
    totalSp: 0,
    queueLength: isTraining ? 1 : 0,
    queueEndDate: null,
    systemName: null,
    shipTypeName: null,
    jumpFatigue: null,
    cloneJump: null,
    walletBalance: null,
    training: {
      isTraining,
      currentSkillTypeId: null,
      currentSkillName: null,
      currentFinishLevel: null,
      finishDate: isTraining ? '2026-09-01T00:00:00Z' : null,
    },
  };
}

describe('buildAccountRows', () => {
  it('counts characters and trainers per account', () => {
    const rows = buildAccountRows(
      [account(1, 'Main'), account(2, 'Alts')],
      [entry(10, 1, true), entry(11, 1), entry(12, 2), entry(13, null, true)],
    );
    expect(rows.map((r) => [r.account.label, r.characterCount, r.trainingCount])).toEqual([
      ['Main', 2, 1],
      ['Alts', 1, 0],
    ]);
  });

  it('flags an Omega account whose characters are all idle', () => {
    const rows = buildAccountRows([account(1, 'Main')], [entry(10, 1), entry(11, 1)]);
    expect(rows[0]!.idleOmega).toBe(true);
  });

  it('does not flag an Omega account with a character training', () => {
    const rows = buildAccountRows([account(1, 'Main')], [entry(10, 1), entry(11, 1, true)]);
    expect(rows[0]!.idleOmega).toBe(false);
  });

  it('does not flag an idle Alpha account', () => {
    const rows = buildAccountRows([account(1, 'Free', false)], [entry(10, 1)]);
    expect(rows[0]!.idleOmega).toBe(false);
  });

  it('does not flag an Omega account with no characters assigned', () => {
    const rows = buildAccountRows([account(1, 'Empty')], []);
    expect(rows[0]).toMatchObject({ characterCount: 0, trainingCount: 0, idleOmega: false });
  });

  it('ignores characters with no account assigned', () => {
    const rows = buildAccountRows([account(1, 'Main')], [entry(10, null, true)]);
    expect(rows[0]).toMatchObject({ characterCount: 0, idleOmega: false });
  });

  it('keeps the account order it was given', () => {
    const rows = buildAccountRows([account(2, 'Bravo'), account(1, 'Alpha')], []);
    expect(rows.map((r) => r.account.id)).toEqual([2, 1]);
  });
});

describe('idleOmegaAccounts', () => {
  it('returns only the flagged rows, in table order', () => {
    const rows = buildAccountRows(
      [account(1, 'Idle One'), account(2, 'Busy'), account(3, 'Idle Two')],
      [entry(10, 1), entry(11, 2, true), entry(12, 3)],
    );
    expect(idleOmegaAccounts(rows).map((r) => r.account.label)).toEqual(['Idle One', 'Idle Two']);
  });

  it('returns nothing when every Omega account is training', () => {
    const rows = buildAccountRows([account(1, 'Main')], [entry(10, 1, true)]);
    expect(idleOmegaAccounts(rows)).toEqual([]);
  });
});
