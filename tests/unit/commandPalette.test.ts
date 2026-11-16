import { describe, expect, it } from 'vitest';
import {
  buildPaletteItems,
  isTypingTarget,
  matchScore,
  searchPalette,
  type PaletteSources,
} from '../../src/renderer/src/lib/commandPalette';

const sources: PaletteSources = {
  pages: [
    { to: '/', label: 'Dashboard' },
    { to: '/roster', label: 'Roster' },
    { to: '/fits', label: 'Fits' },
  ],
  characters: [
    { id: 1, name: 'Raven Pilot', accountLabel: 'Main account' },
    { id: 2, name: 'Venture Alt', accountLabel: 'Miners' },
    { id: 3, name: 'Cyno Guy', accountLabel: null },
  ],
  fits: [{ id: 10, name: 'Doctrine Raven', shipName: 'Raven' }],
  plans: [{ id: 20, name: 'Cyno V' }],
  groups: [{ id: 30, name: 'Miners fleet', memberCount: 1 }],
};
const items = buildPaletteItems(sources);
const keys = (query: string): string[] => searchPalette(items, query).map((i) => i.key);

describe('buildPaletteItems', () => {
  it('routes every kind to its page', () => {
    const byKey = new Map(items.map((i) => [i.key, i]));
    expect(byKey.get('character:1')?.to).toBe('/character/1');
    expect(byKey.get('fit:10')?.to).toBe('/fits/10');
    expect(byKey.get('plan:20')?.to).toBe('/plans/20');
    expect(byKey.get('group:30')?.to).toBe('/groups/30');
    expect(byKey.get('group:30')?.detail).toBe('1 member');
    expect(byKey.get('action:sync-all')?.action).toBe('sync-all');
  });
});

describe('matchScore', () => {
  it('ranks prefix > word start > substring > subsequence > none', () => {
    const prefix = matchScore('venture alt', 'ven');
    const wordStart = matchScore('doctrine venture', 'ven');
    const substring = matchScore('raven', 'ven');
    const subsequence = matchScore('venture', 'vnt');
    expect(prefix).toBeGreaterThan(wordStart);
    expect(wordStart).toBeGreaterThan(substring);
    expect(substring).toBeGreaterThan(subsequence);
    expect(subsequence).toBeGreaterThan(0);
    expect(matchScore('raven', 'xyz')).toBe(0);
  });
});

describe('searchPalette', () => {
  it('lists only pages and actions for an empty query', () => {
    expect(keys('  ')).toEqual(['page:/', 'page:/roster', 'page:/fits', 'action:sync-all']);
  });

  it('puts a name prefix ahead of a substring', () => {
    expect(keys('ven')[0]).toBe('character:2');
    expect(keys('ven')).toContain('character:1');
  });

  it('matches the detail line, below a label match', () => {
    // "miners" is the label of the group and the account of character 2.
    expect(keys('miners')).toEqual(['group:30', 'character:2']);
  });

  it('prefers the closer prefix match, then breaks exact ties by kind', () => {
    // "Cyno V" is a nearer match for "cyno" than "Cyno Guy".
    expect(keys('cyno')).toEqual(['plan:20', 'character:3']);
    expect(keys('raven').slice(0, 2)).toEqual(['character:1', 'fit:10']);
    const tie = buildPaletteItems({
      ...sources,
      characters: [{ id: 9, name: 'Fits', accountLabel: null }],
      fits: [],
    });
    expect(searchPalette(tie, 'fits').map((i) => i.key)).toEqual(['page:/fits', 'character:9']);
  });

  it('is case-insensitive and honours the limit', () => {
    expect(keys('ROSTER')).toEqual(['page:/roster']);
    expect(searchPalette(items, 'a', 2)).toHaveLength(2);
  });
});

describe('isTypingTarget', () => {
  it('treats text fields as typing and toggles as not', () => {
    expect(isTypingTarget({ tagName: 'INPUT', type: 'search' } as unknown as EventTarget)).toBe(true);
    expect(isTypingTarget({ tagName: 'TEXTAREA' } as unknown as EventTarget)).toBe(true);
    expect(isTypingTarget({ tagName: 'DIV', isContentEditable: true } as unknown as EventTarget)).toBe(true);
    expect(isTypingTarget({ tagName: 'INPUT', type: 'checkbox' } as unknown as EventTarget)).toBe(false);
    expect(isTypingTarget({ tagName: 'BUTTON' } as unknown as EventTarget)).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});
