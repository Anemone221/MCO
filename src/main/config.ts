/**
 * ESI / EVE SSO configuration.
 *
 * ESI_CLIENT_ID must be filled in with the client_id of an EVE developer
 * application registered at https://developers.eveonline.com/.
 * Register the app with:
 *   - Callback URL: http://localhost:8765/callback
 *   - Scopes:       the entries in ESI_SCOPES below
 * With the PKCE flow the client_id is NOT a secret, so it is safe to commit.
 * It can be overridden at runtime via the MCO_ESI_CLIENT_ID environment variable.
 */
export const ESI_CLIENT_ID = process.env['MCO_ESI_CLIENT_ID'] ?? '86086e2e49374670918d7795d7e206d0';

export const ESI_CALLBACK_PORT = 8765;
export const ESI_CALLBACK_URL = `http://localhost:${ESI_CALLBACK_PORT}/callback`;

export const SSO_AUTHORIZE_URL = 'https://login.eveonline.com/v2/oauth/authorize';
export const SSO_TOKEN_URL = 'https://login.eveonline.com/v2/oauth/token';

export const ESI_BASE_URL = 'https://esi.evetech.net/latest';

/**
 * EVE Static Data Export (YAML) download URL. The build number in the path is
 * pinned; bump it (or set MCO_SDE_URL) to import a newer SDE release.
 */
export const SDE_URL =
  process.env['MCO_SDE_URL'] ??
  'https://developers.eveonline.com/static-data/tranquility/eve-online-static-data-3351823-yaml.zip';

/** EVE category id for the "Skill" item category. */
export const SKILL_CATEGORY_ID = 16;

export const ESI_SCOPES = [
  'esi-skills.read_skills.v1',
  'esi-skills.read_skillqueue.v1',
  'esi-location.read_location.v1',
  'esi-location.read_ship_type.v1',
  'esi-clones.read_implants.v1',
] as const;

export const APP_VERSION = '0.1.0';
export const CONTACT_EMAIL = 'anemone221@gmail.com';
export const USER_AGENT = `MCO/${APP_VERSION} (${CONTACT_EMAIL}; +https://github.com/Anemone221/MCO)`;

export function isClientIdConfigured(): boolean {
  return ESI_CLIENT_ID !== 'REPLACE_WITH_EVE_APP_CLIENT_ID' && ESI_CLIENT_ID.length > 0;
}
