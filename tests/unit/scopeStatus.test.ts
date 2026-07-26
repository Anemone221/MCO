import { describe, expect, it } from 'vitest';
import { classifyEsiDataStatus, missingScopes } from '@main/auth/scopeStatus';

describe('missingScopes', () => {
  it('returns the required scopes absent from the granted set', () => {
    expect(missingScopes(['a.v1', 'b.v1'], ['b.v1', 'c.v1'])).toEqual(['c.v1']);
  });

  it('returns empty when everything is granted', () => {
    expect(missingScopes(['a.v1', 'b.v1'], ['a.v1'])).toEqual([]);
  });

  it('returns all required scopes for an empty grant', () => {
    expect(missingScopes([], ['a.v1', 'b.v1'])).toEqual(['a.v1', 'b.v1']);
  });
});

describe('classifyEsiDataStatus', () => {
  it('reports ok when synced with all scopes and a healthy token', () => {
    expect(
      classifyEsiDataStatus({ tokenInvalid: false, missingScopes: [], hasSynced: true }),
    ).toBe('ok');
  });

  it('reports pending before the first sync', () => {
    expect(
      classifyEsiDataStatus({ tokenInvalid: false, missingScopes: [], hasSynced: false }),
    ).toBe('pending');
  });

  it('reports scope-missing when required scopes are absent', () => {
    expect(
      classifyEsiDataStatus({ tokenInvalid: false, missingScopes: ['a.v1'], hasSynced: false }),
    ).toBe('scope-missing');
  });

  it('login-expired outranks scope-missing and pending', () => {
    expect(
      classifyEsiDataStatus({ tokenInvalid: true, missingScopes: ['a.v1'], hasSynced: false }),
    ).toBe('login-expired');
  });

  it('scope-missing outranks synced data (stale sync from an older token)', () => {
    expect(
      classifyEsiDataStatus({ tokenInvalid: false, missingScopes: ['a.v1'], hasSynced: true }),
    ).toBe('scope-missing');
  });
});
