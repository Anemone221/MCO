import { describe, expect, it } from 'vitest';
import { nextCloneJumpDate } from '@main/clones/jumpCooldown';

describe('nextCloneJumpDate', () => {
  const lastJump = '2026-07-15T00:00:00.000Z';

  it('returns null when the character has never clone-jumped', () => {
    expect(nextCloneJumpDate(null, 5)).toBeNull();
  });

  it('returns null for an unparseable date', () => {
    expect(nextCloneJumpDate('not-a-date', 5)).toBeNull();
  });

  it('applies the full 24h cooldown with the skill untrained', () => {
    expect(nextCloneJumpDate(lastJump, 0)).toBe('2026-07-16T00:00:00.000Z');
  });

  it('shaves 1 hour per Infomorph Synchronizing level', () => {
    expect(nextCloneJumpDate(lastJump, 3)).toBe('2026-07-15T21:00:00.000Z');
    expect(nextCloneJumpDate(lastJump, 5)).toBe('2026-07-15T19:00:00.000Z');
  });

  it('clamps out-of-range skill levels', () => {
    expect(nextCloneJumpDate(lastJump, 9)).toBe('2026-07-15T19:00:00.000Z');
    expect(nextCloneJumpDate(lastJump, -1)).toBe('2026-07-16T00:00:00.000Z');
  });
});
