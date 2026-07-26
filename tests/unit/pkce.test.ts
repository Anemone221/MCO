import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  characterIdFromSub,
  createPkcePair,
  createState,
  decodeJwtPayload,
  scopesFromPayload,
} from '@main/auth/pkce';

function base64url(input: Buffer): string {
  return input.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

describe('createPkcePair', () => {
  it('produces a verifier and a matching S256 challenge', () => {
    const { verifier, challenge } = createPkcePair();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);

    const expected = base64url(createHash('sha256').update(verifier).digest());
    expect(challenge).toBe(expected);
  });

  it('produces a unique pair on each call', () => {
    expect(createPkcePair().verifier).not.toBe(createPkcePair().verifier);
  });
});

describe('createState', () => {
  it('returns a non-empty url-safe token', () => {
    expect(createState()).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe('decodeJwtPayload', () => {
  it('decodes the payload segment of a JWT', () => {
    const payload = { sub: 'CHARACTER:EVE:90000001', name: 'Test Pilot' };
    const jwt = `${base64url(Buffer.from('{}'))}.${base64url(
      Buffer.from(JSON.stringify(payload)),
    )}.sig`;
    expect(decodeJwtPayload(jwt)).toEqual(payload);
  });

  it('throws on a malformed token', () => {
    expect(() => decodeJwtPayload('not-a-jwt')).toThrow();
  });
});

describe('scopesFromPayload', () => {
  it('returns an array scp claim as-is', () => {
    expect(scopesFromPayload({ scp: ['a.v1', 'b.v1'] })).toEqual(['a.v1', 'b.v1']);
  });

  it('wraps a single-string scp claim (EVE SSO single-scope form)', () => {
    expect(scopesFromPayload({ scp: 'a.v1' })).toEqual(['a.v1']);
  });

  it('returns empty for a missing scp claim', () => {
    expect(scopesFromPayload({})).toEqual([]);
  });
});

describe('characterIdFromSub', () => {
  it('extracts the numeric id from the sub claim', () => {
    expect(characterIdFromSub('CHARACTER:EVE:90000001')).toBe(90000001);
  });

  it('throws when the sub claim is missing or invalid', () => {
    expect(() => characterIdFromSub(undefined)).toThrow();
    expect(() => characterIdFromSub('CHARACTER:EVE:notanumber')).toThrow();
  });
});
