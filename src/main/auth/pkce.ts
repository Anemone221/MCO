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

interface JwtPayload {
  sub?: string;
  name?: string;
  exp?: number;
  scp?: string | string[];
}

/**
 * Decode (without signature verification) the payload of an EVE SSO access
 * token JWT. The token arrives over a direct TLS connection to
 * login.eveonline.com, so for the MVP we trust transport security.
 * TODO: verify the signature against the SSO JWKS endpoint.
 */
export function decodeJwtPayload(jwt: string): JwtPayload {
  const parts = jwt.split('.');
  if (parts.length !== 3) throw new Error('Malformed JWT');
  const payload = parts[1]!.replace(/-/g, '+').replace(/_/g, '/');
  const json = Buffer.from(payload, 'base64').toString('utf8');
  return JSON.parse(json) as JwtPayload;
}

/**
 * Scopes actually granted to an access token, from its `scp` claim. EVE SSO
 * encodes a single scope as a bare string and multiple scopes as an array.
 */
export function scopesFromPayload(payload: JwtPayload): string[] {
  if (Array.isArray(payload.scp)) return payload.scp;
  if (typeof payload.scp === 'string') return [payload.scp];
  return [];
}

/** Extract the numeric character id from the JWT `sub` claim (e.g. "CHARACTER:EVE:90000001"). */
export function characterIdFromSub(sub: string | undefined): number {
  if (!sub) throw new Error('JWT missing sub claim');
  const id = Number(sub.split(':').pop());
  if (!Number.isFinite(id) || id <= 0) throw new Error(`Unexpected sub claim: ${sub}`);
  return id;
}
