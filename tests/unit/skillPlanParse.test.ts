import { describe, expect, it } from 'vitest';
import { parseSkillPlan } from '@main/plans/parse';

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
});
