import { verify as verifySignature, type KeyObject } from 'node:crypto';
import { ESI_CLIENT_ID, SSO_ISSUER } from '../config';
import { getSigningKey } from './jwks';

/**
 * Verification of EVE SSO access-token JWTs.
 *
 * Every token is verified at ingress — the moment it comes back from the token
 * endpoint, before a character row, refresh token, or scope list is derived
 * from it (`esi-oauth.ts`). Downstream code therefore only ever reads claims
 * out of a token whose signature was checked when it was stored, which is why
 * `decodeJwtPayload` below can stay synchronous.
 */

/** Tolerance for a desynced local clock when checking `exp`/`nbf`. */
const CLOCK_SKEW_MS = 60_000;

/**
 * Accepted signing algorithms, as an allowlist. This is the check that matters
 * most: taking `alg` from the token and trusting it is what lets an attacker
 * pass `none` (no signature at all) or swap RS256 for HS256 so the *public* key
 * is used as an HMAC secret. Anything not listed here is rejected before a key
 * is ever fetched. EVE SSO signs with RS256; ES256 is here so a future rotation
 * to EC keys isn't an outage.
 */
const ALGORITHMS = {
  RS256: { hash: 'sha256', keyType: 'rsa' },
  // JWS encodes ECDSA signatures as raw r‖s, not the DER Node defaults to.
  ES256: { hash: 'sha256', keyType: 'ec', dsaEncoding: 'ieee-p1363' },
} as const satisfies Record<string, { hash: string; keyType: string; dsaEncoding?: 'ieee-p1363' }>;

type SupportedAlgorithm = keyof typeof ALGORITHMS;

export interface JwtHeader {
  alg: string;
  kid?: string;
  typ?: string;
}

export interface JwtPayload {
  sub?: string;
  name?: string;
  exp?: number;
  nbf?: number;
  iat?: number;
  iss?: string;
  aud?: string | string[];
  azp?: string;
  scp?: string | string[];
}

/** A token that could not be trusted — bad signature, wrong claims, or no key to check it with. */
export class JwtVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JwtVerificationError';
  }
}

export interface VerifyOptions {
  /** Public key for a token header. Defaults to a lookup against the SSO JWKS. */
  resolveKey?: (header: JwtHeader) => Promise<KeyObject>;
  /** Expected `aud` member. Defaults to this application's client_id. */
  clientId?: string;
  /** Current time in ms; injectable so expiry cases are testable. */
  now?: number;
}

function parseSegment<T>(segment: string, what: string): T {
  try {
    return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as T;
  } catch {
    throw new JwtVerificationError(`Malformed JWT: could not parse the ${what} segment`);
  }
}

interface SplitJwt {
  header: JwtHeader;
  payload: JwtPayload;
  /** The exact bytes the signature covers: the first two segments, still encoded. */
  signingInput: string;
  signature: Buffer;
}

function splitJwt(jwt: string): SplitJwt {
  const parts = jwt.split('.');
  if (parts.length !== 3) throw new JwtVerificationError('Malformed JWT: expected three segments');
  const [encodedHeader, encodedPayload, encodedSignature] = parts as [string, string, string];

  const header = parseSegment<JwtHeader>(encodedHeader, 'header');
  if (typeof header.alg !== 'string') throw new JwtVerificationError('JWT header has no alg');

  return {
    header,
    payload: parseSegment<JwtPayload>(encodedPayload, 'payload'),
    signingInput: `${encodedHeader}.${encodedPayload}`,
    signature: Buffer.from(encodedSignature, 'base64url'),
  };
}

/** CCP issues `iss` as both the bare host and the https form; compare them on equal terms. */
function normalizeIssuer(issuer: string): string {
  return issuer.replace(/^https?:\/\//, '').replace(/\/+$/, '');
}

/**
 * Check the registered claims: who issued the token, who it was issued *for*,
 * and whether it is currently valid. A signature alone proves only that EVE
 * SSO minted the token — not that it was minted for this application.
 */
export function assertClaims(payload: JwtPayload, options: VerifyOptions = {}): void {
  const now = options.now ?? Date.now();
  const clientId = options.clientId ?? ESI_CLIENT_ID;

  if (!payload.iss || normalizeIssuer(payload.iss) !== normalizeIssuer(SSO_ISSUER)) {
    throw new JwtVerificationError(`Unexpected JWT issuer: ${payload.iss ?? '(missing)'}`);
  }

  const audience = typeof payload.aud === 'string' ? [payload.aud] : (payload.aud ?? []);
  if (!audience.includes(clientId)) {
    throw new JwtVerificationError('JWT audience does not include this application');
  }

  if (typeof payload.exp !== 'number') throw new JwtVerificationError('JWT has no exp claim');
  if (payload.exp * 1000 + CLOCK_SKEW_MS <= now) throw new JwtVerificationError('JWT has expired');

  if (typeof payload.nbf === 'number' && payload.nbf * 1000 - CLOCK_SKEW_MS > now) {
    throw new JwtVerificationError('JWT is not valid yet');
  }
}

/**
 * Verify an EVE SSO access token end to end and return its claims: allowlisted
 * algorithm, signature against the SSO JWKS, then the registered claims.
 * Throws `JwtVerificationError` on any failure — it never returns a payload it
 * could not vouch for.
 */
export async function verifyAccessToken(jwt: string, options: VerifyOptions = {}): Promise<JwtPayload> {
  const { header, payload, signingInput, signature } = splitJwt(jwt);

  const spec = ALGORITHMS[header.alg as SupportedAlgorithm] as
    | (typeof ALGORITHMS)[SupportedAlgorithm]
    | undefined;
  if (!spec) throw new JwtVerificationError(`Unsupported JWT algorithm: ${header.alg}`);

  const resolveKey = options.resolveKey ?? ((h: JwtHeader) => getSigningKey(h.kid, h.alg));
  let key: KeyObject;
  try {
    key = await resolveKey(header);
  } catch (err) {
    throw new JwtVerificationError(String(err instanceof Error ? err.message : err));
  }

  // The JWKS is served over TLS by CCP, so a mismatch here is a bug rather than
  // an attack — but verifying an RSA key with an EC alg (or vice versa) would
  // silently fall back to the key's own algorithm, so refuse it outright.
  if (key.asymmetricKeyType !== spec.keyType) {
    throw new JwtVerificationError(
      `Signing key is ${key.asymmetricKeyType ?? 'of unknown type'}, which cannot verify ${header.alg}`,
    );
  }

  const dsaEncoding = 'dsaEncoding' in spec ? spec.dsaEncoding : undefined;
  const verified = verifySignature(
    spec.hash,
    Buffer.from(signingInput, 'ascii'),
    dsaEncoding ? { key, dsaEncoding } : key,
    signature,
  );
  if (!verified) {
    throw new JwtVerificationError('JWT signature does not match the EVE SSO signing key');
  }

  assertClaims(payload, options);
  return payload;
}

/**
 * Read a JWT payload **without verifying anything**.
 *
 * Only for claims read back out of a token MCO already verified and stored
 * itself (`token-store.grantedScopes`). Never use this on a token as it arrives
 * from the network — that is what `verifyAccessToken` is for.
 */
export function decodeJwtPayload(jwt: string): JwtPayload {
  const parts = jwt.split('.');
  if (parts.length !== 3) throw new Error('Malformed JWT');
  return parseSegment<JwtPayload>(parts[1]!, 'payload');
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
