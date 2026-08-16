import { createPublicKey, type KeyObject, type webcrypto } from 'node:crypto';
import { SSO_JWKS_URL, USER_AGENT } from '../config';

/**
 * The EVE SSO JSON Web Key Set — the public keys that sign access-token JWTs.
 *
 * Fetched lazily and cached, because with ~90 characters the scheduler can ask
 * for a key dozens of times in the same second: `load()` is single-flighted so
 * a burst of refreshes shares one HTTP request, and parsed `KeyObject`s are
 * memoized so the same key isn't re-parsed per token.
 *
 * CCP rotates these keys on the order of years, so a *stale* key set is far
 * more useful than none: if a refetch fails while a cached set exists, the
 * cached set is kept and the failure is logged. With no cached set at all the
 * error propagates and verification fails closed — an unverifiable token is
 * never stored.
 */

/** How long a fetched key set is used before it is refetched in the background of a lookup. */
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
/**
 * Minimum age of the cached set before an unknown `kid` may trigger a refetch.
 * Key rotation is the legitimate reason for an unknown kid; the cooldown keeps
 * a token with a bogus kid from turning into one HTTP request per verification.
 */
const ROTATION_REFETCH_COOLDOWN_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;

/** A JWK narrowed to what a signature check needs: a key type, plus the optional `kid` tag. */
type SigningJwk = webcrypto.JsonWebKey & { kty: string; kid?: string };

interface CachedJwks {
  keys: SigningJwk[];
  fetchedAt: number;
}

let cached: CachedJwks | null = null;
let inFlight: Promise<CachedJwks> | null = null;
const keyObjects = new Map<string, KeyObject>();

function isSigningKey(value: unknown): value is SigningJwk {
  if (typeof value !== 'object' || value === null) return false;
  const { kty, use } = value as { kty?: unknown; use?: unknown };
  // `use` is optional; when present anything but "sig" is an encryption key.
  return typeof kty === 'string' && (use === undefined || use === 'sig');
}

async function fetchJwks(): Promise<CachedJwks> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(SSO_JWKS_URL, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`JWKS endpoint returned ${res.status}`);

    const body = (await res.json()) as { keys?: unknown };
    const keys = Array.isArray(body.keys) ? body.keys.filter(isSigningKey) : [];
    if (keys.length === 0) throw new Error('JWKS response contained no usable signing keys');
    return { keys, fetchedAt: Date.now() };
  } finally {
    clearTimeout(timer);
  }
}

/** Return the cached key set, fetching it when absent, stale, or `force`d. */
async function load(force: boolean): Promise<CachedJwks> {
  if (!force && cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached;
  if (inFlight) return inFlight;

  inFlight = fetchJwks()
    .then((next) => {
      cached = next;
      keyObjects.clear();
      return next;
    })
    .catch((err: unknown) => {
      if (cached) {
        console.warn(`[sso] JWKS refresh failed, continuing with cached keys: ${String(err)}`);
        return cached;
      }
      throw new Error(`Could not fetch the EVE SSO signing keys: ${String(err)}`);
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

/**
 * The key a JWT header points at: matched by `kid`, and rejected outright if
 * the JWK declares an `alg` other than the header's — a key published for one
 * algorithm must never be used to verify another.
 */
function selectKey(keys: SigningJwk[], kid: string | undefined, alg: string): SigningJwk | undefined {
  const usable = keys.filter((key) => key.alg === undefined || key.alg === alg);
  if (kid !== undefined) return usable.find((key) => key.kid === kid);
  // No kid in the header is only unambiguous when the set has a single key.
  return usable.length === 1 ? usable[0] : undefined;
}

/** Public key for a JWT header's `kid`/`alg`, refetching once if the kid looks rotated. */
export async function getSigningKey(kid: string | undefined, alg: string): Promise<KeyObject> {
  let jwks = await load(false);
  let jwk = selectKey(jwks.keys, kid, alg);

  if (!jwk && Date.now() - jwks.fetchedAt > ROTATION_REFETCH_COOLDOWN_MS) {
    jwks = await load(true);
    jwk = selectKey(jwks.keys, kid, alg);
  }
  if (!jwk) {
    throw new Error(`No EVE SSO signing key matches kid=${kid ?? '(none)'} alg=${alg}`);
  }

  const cacheKey = `${jwk.kid ?? ''}:${alg}`;
  const existing = keyObjects.get(cacheKey);
  if (existing) return existing;

  const key = createPublicKey({ key: jwk, format: 'jwk' });
  keyObjects.set(cacheKey, key);
  return key;
}
