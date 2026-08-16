import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { createPkcePair, createState } from '@main/auth/pkce';

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
