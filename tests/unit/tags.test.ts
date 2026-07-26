import { describe, expect, it } from 'vitest';
import type { Tag } from '@shared/types';
import {
  filterByTag,
  memberIdSet,
  sectionTagCoverage,
  tagsForCharacter,
} from '@renderer/lib/tags';

function tag(id: number, name: string, characterIds: number[]): Tag {
  return { id, name, color: null, characterIds };
}

const TAGS: Tag[] = [
  tag(1, 'Cyno', [10, 20, 30]),
  tag(2, 'Fax', [20, 40]),
  tag(3, 'Command Boost', []),
];

describe('memberIdSet', () => {
  it('returns null for "all" (no filtering)', () => {
    expect(memberIdSet(TAGS, 'all')).toBeNull();
  });

  it('returns the character ids that have the selected tag', () => {
    expect(memberIdSet(TAGS, 1)).toEqual(new Set([10, 20, 30]));
  });

  it('returns an empty set for a tag nobody has', () => {
    expect(memberIdSet(TAGS, 3)).toEqual(new Set());
  });

  it('returns null when the selected tag no longer exists', () => {
    expect(memberIdSet(TAGS, 999)).toBeNull();
  });
});

describe('filterByTag', () => {
  const entries = [
    { characterId: 10, characterName: 'A' },
    { characterId: 20, characterName: 'B' },
    { characterId: 40, characterName: 'D' },
  ];

  it('passes everything through when the id set is null', () => {
    expect(filterByTag(entries, null)).toEqual(entries);
  });

  it('keeps only entries whose characterId has the tag', () => {
    const ids = memberIdSet(TAGS, 1);
    expect(filterByTag(entries, ids).map((e) => e.characterId)).toEqual([10, 20]);
  });

  it('drops everyone for a tag nobody has', () => {
    const ids = memberIdSet(TAGS, 3);
    expect(filterByTag(entries, ids)).toEqual([]);
  });
});

describe('tagsForCharacter', () => {
  it('returns the tags a character holds, in list order', () => {
    expect(tagsForCharacter(TAGS, 20).map((t) => t.name)).toEqual(['Cyno', 'Fax']);
  });

  it('returns an empty array for an untagged character', () => {
    expect(tagsForCharacter(TAGS, 99)).toEqual([]);
  });
});

describe('sectionTagCoverage', () => {
  it('counts how many of the section already hold each tag', () => {
    // Section = Cyno holders 10, 20, 30. Cyno covers all 3; Fax only 20; none for the rest.
    const coverage = sectionTagCoverage(TAGS, [10, 20, 30]);
    expect(coverage.get(1)).toBe(3);
    expect(coverage.get(2)).toBe(1);
    expect(coverage.get(3)).toBe(0);
  });

  it('ignores tag holders who are not in the section', () => {
    // Only character 20 is in this section; it holds both Cyno and Fax.
    const coverage = sectionTagCoverage(TAGS, [20]);
    expect(coverage.get(1)).toBe(1);
    expect(coverage.get(2)).toBe(1);
  });

  it('reports zero for every tag when the section is empty', () => {
    const coverage = sectionTagCoverage(TAGS, []);
    expect([...coverage.values()]).toEqual([0, 0, 0]);
  });
});
