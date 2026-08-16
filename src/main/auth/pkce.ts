import { createHash, randomBytes } from 'node:crypto';

function base64url(input: Buffer): string {
  return input.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export interface PkcePair {
  verifier: string;
  challenge: string;
}

/** Generate a PKCE verifier/challenge pair (RFC 7636, S256). */
export function createPkcePair(): PkcePair {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

/** Random opaque value for the OAuth `state` parameter (CSRF protection). */
export function createState(): string {
  return base64url(randomBytes(16));
}
