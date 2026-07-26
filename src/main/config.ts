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

/**
 * ESI is versioned by compatibility date now, not by /latest|/v1 path prefixes:
 * requests go to the bare host with an X-Compatibility-Date header, and CCP
 * guarantees response shapes as of that date. Bump the date (or set
 * MCO_ESI_COMPAT_DATE) deliberately, re-testing response handling — same idea
 * as the pinned SDE build below.
 */
export const ESI_BASE_URL = 'https://esi.evetech.net';
export const ESI_COMPATIBILITY_DATE = process.env['MCO_ESI_COMPAT_DATE'] ?? '2026-06-09';

/**
 * EVE Static Data Export (YAML) download URL. The build number in the path is
 * pinned; bump it (or set MCO_SDE_URL) to import a newer SDE release.
 */
export const SDE_URL =
  process.env['MCO_SDE_URL'] ??
  'https://developers.eveonline.com/static-data/tranquility/eve-online-static-data-3351823-yaml.zip';

/** EVE category id for the "Skill" item category. */
export const SKILL_CATEGORY_ID = 16;

export const SCOPE_READ_IMPLANTS = 'esi-clones.read_implants.v1';
export const SCOPE_READ_CLONES = 'esi-clones.read_clones.v1';
export const SCOPE_READ_FATIGUE = 'esi-characters.read_fatigue.v1';
export const SCOPE_READ_WALLET = 'esi-wallet.read_character_wallet.v1';
export const SCOPE_READ_STRUCTURES = 'esi-universe.read_structures.v1';
export const SCOPE_READ_ONLINE = 'esi-location.read_online.v1';

export const ESI_SCOPES = [
  'esi-skills.read_skills.v1',
  'esi-skills.read_skillqueue.v1',
  'esi-location.read_location.v1',
  'esi-location.read_ship_type.v1',
  SCOPE_READ_IMPLANTS,
  SCOPE_READ_CLONES,
  SCOPE_READ_FATIGUE,
  SCOPE_READ_WALLET,
  SCOPE_READ_STRUCTURES,
  SCOPE_READ_ONLINE,
] as const;

export const APP_VERSION = '0.1.0';
export const CONTACT_EMAIL = 'anemone221@gmail.com';
export const GITHUB_URL = 'https://github.com/Anemone221/MCO';
export const USER_AGENT = `MCO/${APP_VERSION} (${CONTACT_EMAIL}; +${GITHUB_URL})`;

export function isClientIdConfigured(): boolean {
  return ESI_CLIENT_ID !== 'REPLACE_WITH_EVE_APP_CLIENT_ID' && ESI_CLIENT_ID.length > 0;
}
