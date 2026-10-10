import { describe, expect, it } from 'vitest';
import { parseSkillPlan } from '@main/plans/parse';
import { formatRemapLine, parseRemapLine } from '@shared/training';

describe('parseSkillPlan', () => {
  it('parses roman-numeral level lines', () => {
    const entries = parseSkillPlan('Gunnery V\nSmall Hybrid Turret IV');
    expect(entries).toEqual([
      { skillName: 'Gunnery', level: 5 },
      { skillName: 'Small Hybrid Turret', level: 4 },
    ]);
  });

  it('parses digit level lines', () => {
    const entries = parseSkillPlan('Spaceship Command 5');
    expect(entries).toEqual([{ skillName: 'Spaceship Command', level: 5 }]);
  });

  it('skips blank lines', () => {
    const entries = parseSkillPlan('Gunnery V\n\n\nMotion Prediction IV');
    expect(entries).toHaveLength(2);
  });

  it('skips a free-text title line with no trailing level token', () => {
    const entries = parseSkillPlan('My Doctrine Plan\nGunnery V');
    expect(entries).toEqual([{ skillName: 'Gunnery', level: 5 }]);
  });

  it('rejects empty or whitespace-only input', () => {
    expect(() => parseSkillPlan('')).toThrow();
    expect(() => parseSkillPlan('   \n  ')).toThrow();
  });

  it('rejects input with no valid entries', () => {
    expect(() => parseSkillPlan('just a title\nanother line')).toThrow();
  });

  it('attaches a remap line to the skill line after it', () => {
    const entries = parseSkillPlan(
      'Gunnery I\n[Remap] Int 17 Mem 17 Per 27 Wil 21 Cha 17\nGunnery II',
    );
    expect(entries).toEqual([
      { skillName: 'Gunnery', level: 1 },
      {
        skillName: 'Gunnery',
        level: 2,
        remapBefore: { intelligence: 17, memory: 17, perception: 27, willpower: 21, charisma: 17 },
      },
    ]);
  });

  it('drops a trailing remap and skips a malformed one', () => {
    expect(parseSkillPlan('Gunnery I\n[Remap] Int 17 Mem 17 Per 27 Wil 21 Cha 17')).toEqual([
      { skillName: 'Gunnery', level: 1 },
    ]);
    expect(parseSkillPlan('[Remap] Per 27\nGunnery I')).toEqual([
      { skillName: 'Gunnery', level: 1 },
    ]);
  });

  it('rejects a plan that is only remap lines', () => {
    expect(() => parseSkillPlan('[Remap] Int 17 Mem 17 Per 27 Wil 21 Cha 17')).toThrow();
  });
});

describe('remap lines', () => {
  const remap = { intelligence: 21, memory: 27, perception: 17, willpower: 17, charisma: 17 };

  it('round-trips through the stored format', () => {
    expect(formatRemapLine(remap)).toBe('[Remap] Int 21 Mem 27 Per 17 Wil 17 Cha 17');
    expect(parseRemapLine(formatRemapLine(remap))).toEqual(remap);
  });

  it('reads the attributes in any order and any case', () => {
    expect(parseRemapLine('[remap] cha 17 wil 17 per 17 mem 27 int 21')).toEqual(remap);
  });

  it('rejects a missing attribute or a value EVE could not produce', () => {
    expect(parseRemapLine('[Remap] Int 21 Mem 27 Per 17 Wil 17')).toBeNull();
    expect(parseRemapLine('[Remap] Int 5 Mem 27 Per 17 Wil 17 Cha 17')).toBeNull();
    expect(parseRemapLine('Gunnery V')).toBeNull();
  });
});
