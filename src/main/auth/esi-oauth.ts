import { createServer } from 'node:http';
import { shell } from 'electron';
import {
  ESI_CALLBACK_PORT,
  ESI_CALLBACK_URL,
  ESI_CLIENT_ID,
  ESI_SCOPES,
  SSO_AUTHORIZE_URL,
  SSO_TOKEN_URL,
  USER_AGENT,
  isClientIdConfigured,
} from '../config';
import { ensureCharacter } from '../db/repositories/characters';
import { clearTokenInvalid, markTokenInvalid } from '../db/repositories/tokens';
import { UserFacingError } from '../errors';
import type { CharacterSummary } from '@shared/types';
import {
  cacheAccessToken,
  grantedScopes,
  persistRefreshToken,
  readRefreshToken,
} from './token-store';
import { createSingleFlight } from './singleFlight';
import { TokenRequestError } from './tokenError';
import { createPkcePair, createState } from './pkce';
import {
  characterIdFromSub,
  scopesFromPayload,
  verifyAccessToken,
  type JwtPayload,
} from './jwt';

const LOGIN_TIMEOUT_MS = 5 * 60_000;

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

const RESULT_PAGE = (message: string): string =>
  `<!doctype html><html><head><meta charset="utf-8"><title>MCO</title></head>
   <body style="font-family:system-ui;background:#0d1117;color:#e6edf3;display:flex;
   align-items:center;justify-content:center;height:100vh;margin:0">
   <div style="text-align:center"><h2>${message}</h2>
   <p style="color:#8b949e">You can close this window and return to MCO.</p></div>
   </body></html>`;

interface PendingCallback {
  /** Resolves with the authorization code once SSO redirects to the listener. */
  code: Promise<string>;
  /** Tear the listener down early, e.g. when the browser never opened. */
  close: () => void;
}

/**
 * Listen on the loopback callback port for EVE SSO's redirect.
 *
 * A request that doesn't carry this login's `state` is answered and **ignored**
 * — the listener stays up for the real redirect. Settling on one would let any
 * local process cancel a sign-in in progress by hitting the port, and the
 * mismatch tells us nothing about the login the user is actually running.
 */
function awaitCallback(expectedState: string): PendingCallback {
  let close = (): void => {};

  const code = new Promise<string>((resolve, reject) => {
    let done = false;
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', ESI_CALLBACK_URL);
      if (url.pathname !== '/callback') {
        res.writeHead(404).end();
        return;
      }

      if (url.searchParams.get('state') !== expectedState) {
        console.warn('[sso] ignoring a callback request that does not match this login');
        res.writeHead(400, { 'Content-Type': 'text/html' }).end(RESULT_PAGE('Unrecognized sign-in callback'));
        return;
      }

      const finish = (httpMessage: string, settle: () => void): void => {
        res.writeHead(200, { 'Content-Type': 'text/html' }).end(RESULT_PAGE(httpMessage));
        close();
        settle();
      };

      const error = url.searchParams.get('error');
      const authCode = url.searchParams.get('code');
      if (error) {
        finish('Sign-in failed', () => reject(new Error(`EVE SSO error: ${error}`)));
      } else if (!authCode) {
        finish('Sign-in failed', () => reject(new Error('No authorization code returned')));
      } else {
        finish('Signed in successfully', () => resolve(authCode));
      }
    });

    const timer = setTimeout(() => {
      close();
      reject(new Error('Login timed out'));
    }, LOGIN_TIMEOUT_MS);

    close = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      server.close();
    };

    server.on('error', (err) => {
      close();
      reject(new Error(`Could not start loopback listener on port ${ESI_CALLBACK_PORT}: ${err.message}`));
    });
    server.listen(ESI_CALLBACK_PORT, '127.0.0.1');
  });

  return { code, close };
}

async function postToken(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(SSO_TOKEN_URL, {
    method: 'POST',
    // No manual Host header: fetch derives it from SSO_TOKEN_URL, and pinning it
    // by hand only creates a mismatch to find if that URL ever moves.
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT,
    },
    body: new URLSearchParams(body).toString(),
  });
  if (!res.ok) {
    throw new TokenRequestError(res.status, await res.text());
  }
  return (await res.json()) as TokenResponse;
}

/**
 * The scopes actually granted to the token, per its JWT — not what we asked
 * for. `fallback` covers the (unobserved) case of a token with no `scp` claim:
 * callers pass the closest thing they know to be true, which is the scope set
 * they requested at login, or the character's already-recorded scopes on a
 * refresh. Never `ESI_SCOPES` blindly — that would erase an opt-in scope a
 * character holds beyond the standard grant.
 */
function grantedScopeString(payload: JwtPayload, fallback: readonly string[]): string {
  const scopes = scopesFromPayload(payload);
  return scopes.length > 0 ? scopes.join(' ') : fallback.join(' ');
}

/**
 * The trust boundary: every token SSO hands back is signature- and
 * claim-checked here, before a character id, name, or scope list is read out of
 * it. Verification failures become user-facing copy — a login that dies on a
 * generic "something went wrong" tells nobody anything, and the reason
 * (unreachable JWKS, clock skew, bad signature) is what makes it actionable.
 */
async function verifiedPayload(accessToken: string): Promise<JwtPayload> {
  try {
    return await verifyAccessToken(accessToken);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new UserFacingError(`EVE SSO returned a token MCO could not verify: ${reason}`);
  }
}

async function storeFromTokenResponse(
  token: TokenResponse,
  requestedScopes: readonly string[],
): Promise<CharacterSummary> {
  const payload = await verifiedPayload(token.access_token);
  const characterId = characterIdFromSub(payload.sub);
  const name = payload.name ?? `Character ${characterId}`;

  // Name only: the JWT carries no corporation, and re-running SSO for an
  // already-tracked character (widening its scopes) must not blank the corp and
  // alliance its last sync recorded.
  ensureCharacter(characterId, name);
  persistRefreshToken(characterId, token.refresh_token, grantedScopeString(payload, requestedScopes));
  cacheAccessToken(characterId, token.access_token, new Date(Date.now() + token.expires_in * 1000));

  return {
    id: characterId,
    name,
    corpId: null,
    allianceId: null,
    accountId: null,
    addedAt: new Date().toISOString(),
    refreshedAt: null,
  };
}

/**
 * Run the full PKCE login flow: open the browser, catch the redirect, store tokens.
 *
 * `extraScopes` are appended to the standard `ESI_SCOPES` grant, for features
 * that ask a single character to opt into a scope the rest of the fleet has no
 * use for (corporation blueprints). They must be listed on the app registration
 * or SSO refuses the authorize request. Re-running this for an existing
 * character simply replaces its token family with a wider-scoped one — the
 * granted set is always read back off the returned JWT, never assumed.
 */
export async function startLogin(
  extraScopes: readonly string[] = [],
): Promise<CharacterSummary> {
  if (!isClientIdConfigured()) {
    throw new UserFacingError(
      'ESI client_id is not configured. Set MCO_ESI_CLIENT_ID or edit src/main/config.ts.',
    );
  }

  const { verifier, challenge } = createPkcePair();
  const state = createState();
  const scopes = [...new Set([...ESI_SCOPES, ...extraScopes])];

  const authorizeUrl = new URL(SSO_AUTHORIZE_URL);
  authorizeUrl.search = new URLSearchParams({
    response_type: 'code',
    redirect_uri: ESI_CALLBACK_URL,
    client_id: ESI_CLIENT_ID,
    scope: scopes.join(' '),
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
  }).toString();

  // The listener must be up before the browser is sent at SSO, but a browser
  // that never opens would otherwise leave it holding the port until the
  // five-minute timeout.
  const pending = awaitCallback(state);
  try {
    await shell.openExternal(authorizeUrl.toString());
  } catch (err) {
    pending.close();
    throw new UserFacingError(
      `MCO could not open your browser to sign in to EVE SSO: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const code = await pending.code;

  const token = await postToken({
    grant_type: 'authorization_code',
    code,
    client_id: ESI_CLIENT_ID,
    code_verifier: verifier,
  });

  return await storeFromTokenResponse(token, scopes);
}

/**
 * One refresh per character at a time.
 *
 * A sync fans out several authed requests for the same character at once
 * (skills, queue, location, …) and on a scheduled sweep the cached access token
 * has always expired, so every one of them would otherwise start its own
 * refresh. SSO rotates the refresh token on the first exchange, which makes the
 * others present a token it has already consumed: at best a wasted round trip,
 * at worst a rejected token that marks the character login-expired — or a
 * reuse-detection revocation of the whole family.
 */
const refreshInFlight = createSingleFlight<number, string>();

/**
 * Exchange a stored refresh token for a fresh access token. Returns the access
 * token JWT. Concurrent calls for one character share a single exchange.
 */
export function refreshAccessToken(characterId: number): Promise<string> {
  return refreshInFlight.run(characterId, () => exchangeRefreshToken(characterId));
}

async function exchangeRefreshToken(characterId: number): Promise<string> {
  const refreshToken = readRefreshToken(characterId);
  if (!refreshToken) throw new Error(`No stored refresh token for character ${characterId}`);

  let token: TokenResponse;
  try {
    token = await postToken({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: ESI_CLIENT_ID,
    });
  } catch (err) {
    // Only `invalid_grant` means this token is actually dead — record that, so
    // the UI can show a calm "login expired" state instead of a raw error.
    // Anything else (a malformed request, SSO throttling or an outage) is not
    // the token's fault and must not deauthorize the character.
    if (err instanceof TokenRequestError) {
      if (err.isRefreshTokenRejected) markTokenInvalid(characterId);
      else console.warn(`[sso] refresh for character ${characterId} failed without invalidating the token:`, err.message);
    }
    throw err;
  }

  // SSO rotated the refresh token the moment it answered — the one we sent is
  // already dead server-side. Record its replacement *before* verifying the
  // access token, keeping the previously recorded scopes: verification is a
  // check on the access token, not on this opaque string, and letting a failed
  // check discard it would cost the whole token family (a re-login for that
  // character) instead of one sync. The authoritative write, with the scopes
  // this token actually carries, happens below once the payload is trusted.
  persistRefreshToken(characterId, token.refresh_token, grantedScopes(characterId).join(' '));

  const payload = await verifiedPayload(token.access_token);
  // A verified token still has to be the *right* token: binding the `sub` claim
  // to the character we asked for keeps a mixed-up or swapped response from
  // overwriting one character's token family with another's.
  const tokenCharacterId = characterIdFromSub(payload.sub);
  if (tokenCharacterId !== characterId) {
    throw new Error(
      `Refreshed token belongs to character ${tokenCharacterId}, expected ${characterId}`,
    );
  }

  clearTokenInvalid(characterId);
  persistRefreshToken(
    characterId,
    token.refresh_token,
    grantedScopeString(payload, grantedScopes(characterId)),
  );
  cacheAccessToken(characterId, token.access_token, new Date(Date.now() + token.expires_in * 1000));
  return token.access_token;
}
