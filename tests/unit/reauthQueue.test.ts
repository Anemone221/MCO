import { describe, expect, it } from 'vitest';
import type { CharacterSyncStatus } from '@shared/types';
import {
  afterSignIn,
  afterSkip,
  reauthQueue,
  reauthReason,
  type ReauthEntry,
} from '@renderer/lib/reauthQueue';

function status(
  id: number,
  name: string,
  over: Partial<CharacterSyncStatus> = {},
): CharacterSyncStatus {
  return {
    characterId: id,
    characterName: name,
    accountLabel: null,
    refreshedAt: null,
    nextDueAt: null,
    state: 'ok',
    missingScopes: [],
    ...over,
  };
}

const entry = (id: number, name: string): ReauthEntry => ({
  characterId: id,
  characterName: name,
  reason: 'scope-missing',
  missingScopes: ['esi-x.v1'],
});

describe('reauthQueue', () => {
  it('lists only characters with an expired login or a missing scope', () => {
    const queue = reauthQueue([
      status(1, 'Fine'),
      status(2, 'Due', { state: 'due' }),
      status(3, 'Never', { state: 'never-synced' }),
      status(4, 'Scopeless', { missingScopes: ['esi-a.v1'] }),
      status(5, 'Expired', { state: 'login-expired' }),
    ]);
    expect(queue.map((e) => e.characterId)).toEqual([5, 4]);
  });

  it('puts expired logins first, then sorts by name', () => {
    const queue = reauthQueue([
      status(1, 'Zed', { missingScopes: ['esi-a.v1'] }),
      status(2, 'Bea', { state: 'login-expired' }),
      status(3, 'Amy', { missingScopes: ['esi-a.v1'] }),
      status(4, 'Abe', { state: 'login-expired' }),
    ]);
    expect(queue.map((e) => e.characterName)).toEqual(['Abe', 'Bea', 'Amy', 'Zed']);
  });

  it('calls an expired login expired even when scopes are missing too', () => {
    const [only] = reauthQueue([
      status(1, 'Both', { state: 'login-expired', missingScopes: ['esi-a.v1'] }),
    ]);
    expect(only?.reason).toBe('login-expired');
    expect(reauthReason(only!)).toBe('Login expired');
  });

  it('counts the missing scopes in the reason', () => {
    expect(reauthReason({ ...entry(1, 'A'), missingScopes: ['a'] })).toBe('1 scope missing');
    expect(reauthReason({ ...entry(1, 'A'), missingScopes: ['a', 'b', 'c'] })).toBe(
      '3 scopes missing',
    );
  });
});

describe('afterSignIn', () => {
  const queue = [entry(1, 'Abe'), entry(2, 'Bea'), entry(3, 'Cy')];

  it('moves on when the character asked for signed in', () => {
    const step = afterSignIn(queue, { id: 1, name: 'Abe' });
    expect(step.remaining.map((e) => e.characterId)).toEqual([2, 3]);
    expect(step.note).toBeNull();
  });

  it('keeps asking for the same character when a later one in the queue signed in instead', () => {
    const step = afterSignIn(queue, { id: 3, name: 'Cy' });
    // Cy is done and leaves; Abe is still first.
    expect(step.remaining.map((e) => e.characterId)).toEqual([1, 2]);
    expect(step.note).toContain('Cy, which is now re-authorized');
    expect(step.note).toContain('Abe still needs its own');
  });

  it('keeps the queue intact when a character outside it signed in', () => {
    const step = afterSignIn(queue, { id: 99, name: 'Stranger' });
    expect(step.remaining.map((e) => e.characterId)).toEqual([1, 2, 3]);
    expect(step.note).toContain('Stranger, not one waiting here');
  });

  it('ends cleanly on an empty queue', () => {
    expect(afterSignIn([], { id: 1, name: 'Abe' })).toEqual({ remaining: [], note: null });
  });
});

describe('afterSkip', () => {
  it('drops the character at the front', () => {
    const step = afterSkip([entry(1, 'Abe'), entry(2, 'Bea')]);
    expect(step.remaining.map((e) => e.characterId)).toEqual([2]);
  });
});
