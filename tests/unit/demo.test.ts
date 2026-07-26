import { describe, expect, it } from 'vitest';
import {
  demoAccountLabel,
  demoCharacterName,
  demoLocationEntry,
  demoLocationName,
  demoPath,
  demoRosterEntry,
  demoSystemName,
  demoText,
  isDemoMode,
} from '@renderer/lib/demo';
import type { LocationEntry, RosterEntry } from '@shared/types';

// The demo module keeps one mapping table per session (module state), so all
// assertions below hold across tests in this file too — by design: a
// character must keep its fake name no matter which page asked first.

describe('demoCharacterName', () => {
  it('is deterministic per character id', () => {
    expect(demoCharacterName(96_000_001)).toBe(demoCharacterName(96_000_001));
  });

  it('never assigns the same fake name to two characters', () => {
    const names = new Set<string>();
    for (let id = 1; id <= 200; id++) names.add(demoCharacterName(id));
    expect(names.size).toBe(200);
  });

  it('does not leak the real name', () => {
    expect(demoCharacterName(96_000_002, 'My Real Pilot')).not.toContain('My Real Pilot');
  });
});

describe('demoSystemName / demoLocationName / demoAccountLabel', () => {
  it('passes null through', () => {
    expect(demoSystemName(null)).toBeNull();
    expect(demoLocationName(null)).toBeNull();
    expect(demoAccountLabel(null)).toBeNull();
  });

  it('maps the same real name to the same fake name', () => {
    expect(demoSystemName('Jita')).toBe(demoSystemName('Jita'));
    expect(demoAccountLabel('Main')).toBe(demoAccountLabel('Main'));
  });

  it('keeps fake system names unique even past the pool size', () => {
    const fakes = new Set<string>();
    for (let i = 0; i < 40; i++) fakes.add(demoSystemName(`RealSystem-${i}`) ?? '');
    expect(fakes.size).toBe(40);
  });

  it('builds station-style location names', () => {
    expect(demoLocationName('Jita IV - Moon 4 - Caldari Navy Assembly Plant')).toMatch(
      /^\S+ [IVX]+ - Moon \d+ - .+$/,
    );
  });
});

describe('demoText', () => {
  it('replaces real names seen by earlier scrubs inside free text', () => {
    const fakeName = demoCharacterName(96_000_003, 'Awox Alt');
    const fakeSystem = demoSystemName('Amarr');
    expect(demoText('Awox Alt finished training in Amarr')).toBe(
      `${fakeName} finished training in ${fakeSystem}`,
    );
  });

  it('leaves unknown text untouched', () => {
    expect(demoText('Skill queue is empty')).toBe('Skill queue is empty');
  });
});

describe('demoPath', () => {
  it('masks the OS user segment on Windows and POSIX paths', () => {
    expect(demoPath('C:\\Users\\anemo\\AppData\\Roaming\\mco\\mco.sqlite')).toBe(
      'C:\\Users\\demo\\AppData\\Roaming\\mco\\mco.sqlite',
    );
    expect(demoPath('/Users/anemo/Library/mco/mco.sqlite')).toBe(
      '/Users/demo/Library/mco/mco.sqlite',
    );
    expect(demoPath('/home/anemo/.config/mco/mco.sqlite')).toBe(
      '/home/demo/.config/mco/mco.sqlite',
    );
  });
});

describe('isDemoMode', () => {
  it('defaults to off (and never throws without localStorage)', () => {
    expect(isDemoMode()).toBe(false);
  });
});

function rosterEntry(): RosterEntry {
  return {
    character: {
      id: 96_000_010,
      name: 'Secret Pilot',
      corpId: 1,
      allianceId: null,
      accountId: 3,
      addedAt: '2026-01-01T00:00:00Z',
      refreshedAt: null,
    },
    accountLabel: 'Krab Farm',
    totalSp: 55_000_000,
    training: {
      isTraining: false,
      currentSkillTypeId: null,
      currentSkillName: null,
      currentFinishLevel: null,
      finishDate: null,
    },
    systemName: '1DQ1-A',
    shipTypeName: 'Rorqual',
    jumpFatigue: null,
    cloneJump: null,
    walletBalance: 1000,
  };
}

describe('demoRosterEntry', () => {
  it('scrubs name, account label and system but keeps everything else', () => {
    const entry = demoRosterEntry(rosterEntry());
    expect(entry.character.name).not.toBe('Secret Pilot');
    expect(entry.accountLabel).not.toBe('Krab Farm');
    expect(entry.systemName).not.toBe('1DQ1-A');
    expect(entry.character.id).toBe(96_000_010);
    expect(entry.totalSp).toBe(55_000_000);
    expect(entry.shipTypeName).toBe('Rorqual');
  });
});

describe('demoLocationEntry', () => {
  it('scrubs the player-assigned ship name into the default-name style', () => {
    const entry: LocationEntry = {
      characterId: 96_000_011,
      characterName: 'Secret Hauler',
      accountLabel: null,
      systemId: 30_000_142,
      systemName: 'Jita',
      security: 0.9,
      regionId: 10_000_002,
      regionName: 'The Forge',
      docked: true,
      dockedName: 'Jita IV - Moon 4 - Caldari Navy Assembly Plant',
      shipName: 'Secret Hauler Deluxe',
      shipTypeName: 'Charon',
      updatedAt: null,
    };
    const scrubbed = demoLocationEntry(entry);
    expect(scrubbed.characterName).not.toBe('Secret Hauler');
    expect(scrubbed.shipName).toMatch(/'s Charon$/);
    expect(scrubbed.shipName).not.toContain('Secret');
    expect(scrubbed.regionName).not.toBe('The Forge');
    expect(scrubbed.dockedName).not.toContain('Jita');
  });
});
