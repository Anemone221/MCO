import packageJson from '../../package.json';

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
 * Public keys that sign EVE SSO access tokens, used to verify every token's
 * signature before anything is stored from it (see `auth/jwks.ts`).
 */
export const SSO_JWKS_URL = 'https://login.eveonline.com/oauth/jwks';

/**
 * Expected `iss` claim. CCP issues both the bare host and the https form
 * depending on the endpoint, so the claim is normalized (scheme and trailing
 * slash stripped) before it is compared against this.
 */
export const SSO_ISSUER = 'login.eveonline.com';

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
 * Where CCP publishes the EVE Static Data Export. Every build lives under this
 * prefix under a name that carries its build number, alongside a catalogue of
 * the current one (`latest.jsonl`).
 */
export const SDE_BASE_URL = 'https://developers.eveonline.com/static-data/tranquility';

/**
 * The catalogue MCO reads to learn whether a newer SDE build exists — one JSON
 * line, `{"_key": "sde", "buildNumber": …, "releaseDate": …}`.
 *
 * This is what keeps new skills, ships and blueprints reachable without an app
 * release: the build number is discovered at runtime rather than compiled in,
 * so a game patch is a re-import (see `services/sdeUpdateService.ts`) and only
 * a *format* change needs a new MCO.
 */
export const SDE_LATEST_URL = `${SDE_BASE_URL}/latest.jsonl`;

/** The SDE zip for one build number. */
export function sdeZipUrl(build: string): string {
  return `${SDE_BASE_URL}/eve-online-static-data-${build}-yaml.zip`;
}

/**
 * The build imported when the catalogue can't be read (no network, CCP moved
 * the endpoint). Old data beats no data: every id still resolves to a name,
 * only the last few patches' items are missing. Bumping it is no longer how
 * users get a newer SDE — it is only the floor.
 */
export const SDE_PINNED_BUILD = '3351823';

/**
 * An exact zip URL to import instead of whatever the catalogue reports. Set
 * `MCO_SDE_URL` to test an unreleased or local build; while it is set the
 * update check stands down rather than offer a build the import won't fetch.
 */
export const SDE_URL_OVERRIDE: string | null = process.env['MCO_SDE_URL'] ?? null;

/** The fallback download: the override if there is one, else the pinned build. */
export const SDE_URL = SDE_URL_OVERRIDE ?? sdeZipUrl(SDE_PINNED_BUILD);

/** EVE category id for the "Skill" item category. */
export const SKILL_CATEGORY_ID = 16;

export const SCOPE_READ_IMPLANTS = 'esi-clones.read_implants.v1';
export const SCOPE_READ_CLONES = 'esi-clones.read_clones.v1';
export const SCOPE_READ_FATIGUE = 'esi-characters.read_fatigue.v1';
export const SCOPE_READ_WALLET = 'esi-wallet.read_character_wallet.v1';
export const SCOPE_READ_STRUCTURES = 'esi-universe.read_structures.v1';
export const SCOPE_READ_ONLINE = 'esi-location.read_online.v1';
export const SCOPE_READ_BLUEPRINTS = 'esi-characters.read_blueprints.v1';

/**
 * Blueprints an **alt corp** holds — a corporation wholly controlled by one
 * player, used as a shared hangar. Deliberately NOT in `ESI_SCOPES`: it is the
 * only corporation scope MCO asks for, ESI grants it only to a character with
 * the Director role, and asking all ~90 characters for a corp scope none of
 * them can use is noise on the SSO consent screen. It is instead requested
 * per character, on demand, via `startLogin` (see `OPTIONAL_ESI_SCOPES`).
 */
export const SCOPE_READ_CORP_BLUEPRINTS = 'esi-corporations.read_blueprints.v1';

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
  SCOPE_READ_BLUEPRINTS,
] as const;

/**
 * Scopes never requested by a plain "Add character" — a character opts into one
 * by re-running SSO from the feature that needs it. The app registration at
 * developers.eveonline.com must still list them, or SSO refuses the authorize
 * request that asks for one.
 */
export const OPTIONAL_ESI_SCOPES = [SCOPE_READ_CORP_BLUEPRINTS] as const;

/**
 * The running build's version, read from package.json rather than written
 * twice.
 *
 * That field is the one electron-builder stamps the installer (and
 * `app.getVersion()`) with, so it is also what a release is tagged from — and
 * the update check in `services/updateService.ts` compares a published tag
 * against it. A second hand-maintained copy that fell behind would make MCO
 * quietly report itself up to date forever. Read here rather than via
 * `app.getVersion()` so this module stays free of `electron` and its pure
 * consumers keep unit-testing without it.
 */
export const APP_VERSION: string = packageJson.version;

export const CONTACT_EMAIL = 'anemone221@gmail.com';
export const GITHUB_URL = 'https://github.com/Anemone221/MCO';
/** Where a user is sent to download a newer build (see `update/github.ts`). */
export const GITHUB_RELEASES_URL = `${GITHUB_URL}/releases`;
export const USER_AGENT = `MCO/${APP_VERSION} (${CONTACT_EMAIL}; +${GITHUB_URL})`;

export function isClientIdConfigured(): boolean {
  return ESI_CLIENT_ID !== 'REPLACE_WITH_EVE_APP_CLIENT_ID' && ESI_CLIENT_ID.length > 0;
}
