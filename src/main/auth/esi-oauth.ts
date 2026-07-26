import { createServer, type Server } from 'node:http';
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
import { upsertCharacter } from '../db/repositories/characters';
import { clearTokenInvalid, markTokenInvalid } from '../db/repositories/tokens';
import type { CharacterSummary } from '@shared/types';
import { cacheAccessToken, persistRefreshToken, readRefreshToken } from './token-store';
import {
  characterIdFromSub,
  createPkcePair,
  createState,
  decodeJwtPayload,
  scopesFromPayload,
} from './pkce';

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

/** Wait for EVE SSO to redirect to the loopback listener; resolve with the auth code. */
function awaitCallback(expectedState: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let server: Server;
    const timer = setTimeout(() => {
      server.close();
      reject(new Error('Login timed out'));
    }, LOGIN_TIMEOUT_MS);

    server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', ESI_CALLBACK_URL);
      if (url.pathname !== '/callback') {
        res.writeHead(404).end();
        return;
      }
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const error = url.searchParams.get('error');

      const finish = (httpMessage: string, settle: () => void): void => {
        res.writeHead(200, { 'Content-Type': 'text/html' }).end(RESULT_PAGE(httpMessage));
        clearTimeout(timer);
        server.close();
        settle();
      };

      if (error) {
        finish('Sign-in failed', () => reject(new Error(`EVE SSO error: ${error}`)));
      } else if (state !== expectedState) {
        finish('Sign-in failed', () => reject(new Error('OAuth state mismatch')));
      } else if (!code) {
        finish('Sign-in failed', () => reject(new Error('No authorization code returned')));
      } else {
        finish('Signed in successfully', () => resolve(code));
      }
    });

    server.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`Could not start loopback listener on port ${ESI_CALLBACK_PORT}: ${err.message}`));
    });
    server.listen(ESI_CALLBACK_PORT, '127.0.0.1');
  });
}

class TokenRequestError extends Error {
  constructor(
    readonly status: number,
    body: string,
  ) {
    super(`Token endpoint returned ${status}: ${body}`);
  }
}

async function postToken(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(SSO_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT,
      Host: 'login.eveonline.com',
    },
    body: new URLSearchParams(body).toString(),
  });
  if (!res.ok) {
    throw new TokenRequestError(res.status, await res.text());
  }
  return (await res.json()) as TokenResponse;
}

/** The scopes actually granted to the token, per its JWT — not what we asked for. */
function grantedScopeString(token: TokenResponse): string {
  const scopes = scopesFromPayload(decodeJwtPayload(token.access_token));
  return scopes.length > 0 ? scopes.join(' ') : ESI_SCOPES.join(' ');
}

function storeFromTokenResponse(token: TokenResponse): CharacterSummary {
  const payload = decodeJwtPayload(token.access_token);
  const characterId = characterIdFromSub(payload.sub);
  const name = payload.name ?? `Character ${characterId}`;

  upsertCharacter({ id: characterId, name });
  persistRefreshToken(characterId, token.refresh_token, grantedScopeString(token));
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

/** Run the full PKCE login flow: open the browser, catch the redirect, store tokens. */
export async function startLogin(): Promise<CharacterSummary> {
  if (!isClientIdConfigured()) {
    throw new Error(
      'ESI client_id is not configured. Set MCO_ESI_CLIENT_ID or edit src/main/config.ts.',
    );
  }

  const { verifier, challenge } = createPkcePair();
  const state = createState();

  const authorizeUrl = new URL(SSO_AUTHORIZE_URL);
  authorizeUrl.search = new URLSearchParams({
    response_type: 'code',
    redirect_uri: ESI_CALLBACK_URL,
    client_id: ESI_CLIENT_ID,
    scope: ESI_SCOPES.join(' '),
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
  }).toString();

  const callbackPromise = awaitCallback(state);
  await shell.openExternal(authorizeUrl.toString());
  const code = await callbackPromise;

  const token = await postToken({
    grant_type: 'authorization_code',
    code,
    client_id: ESI_CLIENT_ID,
    code_verifier: verifier,
  });

  return storeFromTokenResponse(token);
}

/** Exchange a stored refresh token for a fresh access token. Returns the access token JWT. */
export async function refreshAccessToken(characterId: number): Promise<string> {
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
    // A 4xx from SSO means the refresh token itself was rejected (expired,
    // revoked, or the family was invalidated) — record it so the UI can show
    // a calm "login expired" state instead of a raw error.
    if (err instanceof TokenRequestError && err.status >= 400 && err.status < 500) {
      markTokenInvalid(characterId);
    }
    throw err;
  }

  clearTokenInvalid(characterId);
  persistRefreshToken(characterId, token.refresh_token, grantedScopeString(token));
  cacheAccessToken(characterId, token.access_token, new Date(Date.now() + token.expires_in * 1000));
  return token.access_token;
}
