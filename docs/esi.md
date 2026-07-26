# ESI & EVE SSO

Everything that talks to CCP's servers lives in `src/main/esi/` and `src/main/auth/`,
configured by `src/main/config.ts`.

Reference material:
- ESI docs: https://github.com/esi/esi-docs
- Rate limiting: https://developers.eveonline.com/docs/services/esi/rate-limiting/
- Best practices: https://developers.eveonline.com/docs/services/esi/best-practices/

## Configuration (`src/main/config.ts`)

| Constant | Value / meaning |
| --- | --- |
| `ESI_CLIENT_ID` | client_id of the registered EVE developer application. **Not a secret** under PKCE, so it is committed; override with `MCO_ESI_CLIENT_ID`. |
| `ESI_CALLBACK_URL` | `http://localhost:8765/callback` — must match the app registration at developers.eveonline.com. |
| `ESI_BASE_URL` | `https://esi.evetech.net` — ESI is versioned by **compatibility date**, not path prefixes. |
| `ESI_COMPATIBILITY_DATE` | Pinned date sent as `X-Compatibility-Date` on every request; CCP guarantees response shapes as of that date. Bump deliberately (or override with `MCO_ESI_COMPAT_DATE`), re-testing response handling. |
| `ESI_SCOPES` | skills, skillqueue, location, ship type, implants, clones, fatigue, wallet, structures, online (see below). |
| `USER_AGENT` | `MCO/<version> (<contact email>; +repo URL)` — sent on every ESI/SSO/SDE request per CCP best practice. |

Required scopes:

```
esi-skills.read_skills.v1        esi-skills.read_skillqueue.v1
esi-location.read_location.v1    esi-location.read_ship_type.v1
esi-clones.read_implants.v1      esi-clones.read_clones.v1
esi-characters.read_fatigue.v1   esi-wallet.read_character_wallet.v1
esi-universe.read_structures.v1  esi-location.read_online.v1
```

## Login flow — OAuth2 authorization code + PKCE (`auth/esi-oauth.ts`)

"Add character" runs `startLogin()`:

1. Generate a PKCE verifier/challenge pair (S256) and a random `state` (`auth/pkce.ts`).
2. Start a loopback HTTP listener on `127.0.0.1:8765` (5-minute timeout).
3. Open the system browser at `login.eveonline.com/v2/oauth/authorize` with the client_id,
   scopes, challenge and state.
4. SSO redirects to `/callback`; the listener validates `state`, shows a small
   "signed in" page, and captures the authorization code.
5. Exchange code + verifier at the token endpoint → access token (a JWT) + refresh token.
6. Decode the JWT payload (no signature verification yet — see TODO in `pkce.ts`; the
   token arrives over direct TLS to login.eveonline.com): `sub` gives the character id,
   `name` the character name, `scp` the **actually granted** scopes.
7. Upsert the character row, persist the refresh token + granted scopes, cache the access
   token. An initial full sync is attempted right away (failure is fine — the scheduler
   retries).

There is no "log in as user" concept — each character is its own token; an account is
just a local grouping bucket (ESI never exposes account membership).

## Token storage & refresh (`auth/token-store.ts`, `db/repositories/tokens.ts`)

- **Refresh token**: encrypted with Electron `safeStorage` (OS keychain/DPAPI) before
  being stored in the `tokens` table. If OS encryption is unavailable, MCO refuses to
  store tokens rather than storing them in plaintext.
- **Access token**: short-lived JWT, cached in the same row with its expiry;
  `getValidCachedAccessToken` returns it only while it has ≥ 60 s left.
- **Refresh**: `refreshAccessToken()` exchanges the stored refresh token. EVE SSO
  *rotates* refresh tokens on every use — the new one always replaces the old. This is
  why the app enforces a single process per profile (see
  [architecture.md](architecture.md#launch-modes--lifecycle-srcmainindexts)).
- **Invalidation**: a 4xx from the token endpoint means the refresh token is dead
  (expired/revoked/family invalidated). `markTokenInvalid` stamps `tokens.invalid_at`;
  the UI surfaces this as a calm "login expired — re-add the character" state rather
  than an error. A later successful refresh clears the flag.

### Scope truth (`grantedScopes`)

The scopes a token *actually has* can differ from what we requested (user may untick
scopes on the SSO page, or the token may predate a scope we added to `ESI_SCOPES`
later). `grantedScopes()` prefers the `scp` claim of the last-seen access token, falling
back to the scope list recorded at login. Sync uses `hasGrantedScope()` to skip calls
the token can't make.

### `EsiDataStatus` (`auth/scopeStatus.ts`, `shared/types.ts`)

Feature-agnostic classification of *why* a character's data for some ESI-backed feature
may be missing, used by boards like Clones:

| Status | Meaning |
| --- | --- |
| `ok` | Data has synced. |
| `pending` | Scopes granted, first sync hasn't happened yet. |
| `scope-missing` | Token lacks required scope(s) — character must be re-added. |
| `login-expired` | SSO rejected the refresh token — character must be re-added. |

## The HTTP client (`esi/client.ts`)

Every ESI request goes through `esiGet<T>(path, { characterId? })`. Never call `fetch`
against ESI directly. `esiGet` provides:

- **Freshness cache**: responses are stored in the `esi_cache` table with the `Expires`
  header. While an entry is fresh, **no request is made at all** — the cached body is
  returned. This is what drives sync cadence (a character is "due" when its `/skills/`
  cache entry expires) and is CCP's #1 best practice.
- **ETag revalidation**: expired entries are refetched with `If-None-Match`; a `304`
  refreshes the expiry without re-downloading the body.
- **Auth**: pass `characterId` for authed routes; the client uses the cached access token
  or refreshes it. On a `401` it refreshes once and retries.
- **Versioning**: every request carries `X-Compatibility-Date: <ESI_COMPATIBILITY_DATE>`
  (the modern replacement for `/latest`-style path versioning).
- **Throttle handling**: `420` (legacy error limit) **and** `429` (new floating-window
  bucket) open a shared backoff — from the `Retry-After` header when present, else 60 s —
  and retry on a *separate* budget (`MAX_THROTTLE_WAITS`) that does **not** consume the
  transient-error retries. Being throttled isn't the request's fault, so waiting out a
  fleet-wide backoff must not fail the request.
- **5xx / network / timeout**: linear backoff retry, up to `MAX_RETRIES` (3) total. Every
  request has a 30 s `AbortController` timeout so a stalled socket can't pin a slot.

## Rate limiting (`esi/rate-limiter.ts`)

ESI runs **two** limiters (see the [rate-limiting doc](https://developers.eveonline.com/docs/services/esi/rate-limiting/)):

- **Legacy error limit** — at most ~100 non-2xx/3xx responses per rolling 60 s window,
  advertised via `X-ESI-Error-Limit-Remain` / `-Reset`. Exceeding it earns **420** for
  everyone from your IP. Only *errors* count — successful requests are free.
- **Floating-window bucket** (rolling out per route) — a token bucket keyed by
  `applicationID:characterID` (authed) or source IP (public). Costs are **2 tokens per
  2xx**, 1 per 3xx, 5 per 4xx, 0 per 5xx; over budget returns **429** with `Retry-After`
  and `X-Ratelimit-*` headers. Note that even *successful* requests spend tokens here.

The singleton `RateLimiter` applies three cooperating controls:

- **Concurrency cap** — at most **20** (`DEFAULT_MAX_CONCURRENCY`) requests in flight; a
  ceiling on burst width.
- **Dispatch pacer** — a minimum **~120 ms** gap between request *starts*
  (`DEFAULT_MIN_SPACING_MS`, ~8 req/s). Without it a 90+ character sweep drains its
  ~1k-request backlog as fast as ESI answers — hundreds of req/s — which is what tripped
  the error limit overnight. Pacing trickles the sweep out over ~2 min instead. This is
  the "offset requests" behaviour a large fleet needs.
- **Backoff window** — `observe()` pauses everyone when the error-limit `remain` drops to
  **10 or below** (`ERROR_LIMIT_FLOOR`); `forceBackoff` / `backoffFromHeaders` open a
  window on an actual 420/429 (honouring `Retry-After`). Backoff only ever extends, and is
  honoured by the pacer before any dispatch.

Sweeps also **wave**: `syncCharacterList` processes characters in jittered batches of 8
(`SWEEP_WAVE_SIZE` in `services/characterSync.ts`) rather than one fleet-wide
`Promise.allSettled`, so any errors spread across the sweep instead of concentrating the
whole error budget into one minute.

## ESI diagnostics log (`esi/esiLog.ts`)

Because a 90+ character sweep makes ~1k requests, logging every success would bury the
signal. `esiLog` instead keeps **running counters** for every outcome (cache-fresh, 200,
304, 401→refresh, 420, 429, 5xx, other-4xx, timeouts, network errors, give-ups, slow,
backoff windows) plus a **ring buffer of only the noteworthy events** — throttles,
transient retries, timeouts, give-ups, proactive backoff windows, and sweep boundaries.
`esiGet` records into it at each branch; `syncCharacterList` brackets each sweep with a
`sweep` marker for correlation. It's in-memory and session-scoped (like the console
capture in `log.ts`).

It surfaces two ways:

- **Settings → ESI activity** — a live readout (counters + the last few events), fed by
  the `settings:esiActivity` IPC channel (`getEsiActivity()`). Throttles/timeouts/give-ups
  render as danger chips; an active backoff shows a blue "paused ~Ns" chip.
- **Settings → Export logs** — `formatEsiDiagnostics()` prepends the full counter summary
  and event history to the diagnostics file, ahead of the captured console session log.

When investigating a throttling report, the export is the artifact to read: the counters
show whether 420s/429s actually fired and how much time went to backoff, and the event
list shows which routes/characters and when (against the sweep markers).

## Endpoint wrappers (`esi/endpoints.ts`)

Thin, typed wrappers — one function per route, no logic:

| Function | Route | Auth |
| --- | --- | --- |
| `getCharacterPublic` | `/characters/{id}` | public |
| `getCharacterSkills` | `/characters/{id}/skills` | scoped |
| `getCharacterSkillQueue` | `/characters/{id}/skillqueue` | scoped |
| `getCharacterAttributes` | `/characters/{id}/attributes` | scoped |
| `getCharacterLocation` | `/characters/{id}/location` | scoped |
| `getCharacterShip` | `/characters/{id}/ship` | scoped |
| `getCharacterImplants` | `/characters/{id}/implants` | scoped |
| `getCharacterClones` | `/characters/{id}/clones` | scoped |
| `getCharacterFatigue` | `/characters/{id}/fatigue` | scoped |
| `getCharacterWallet` | `/characters/{id}/wallet` | scoped |
| `getCharacterWalletJournal` | `/characters/{id}/wallet/journal` | scoped (same scope as `getCharacterWallet`) |
| `getCharacterOnline` | `/characters/{id}/online` | scoped |
| `getStation` | `/universe/stations/{id}` | public |
| `getPublicStructureIds` | `/universe/structures` | public |
| `getStructure` | `/universe/structures/{id}` | scoped + on the structure's ACL (403 otherwise) |
| `getServerStatus` | `/status/` | public |

New endpoints follow the same shape: define the response interface, add a one-line
wrapper, and call it from a service.

### Dashboard-specific sync notes

- **Online status** (`character_online`, `SCOPE_READ_ONLINE`): fetched once per
  sync, same shape as every other scope-gated best-effort block in
  `characterSync.ts`.
- **Wallet journal** (`character_wallet_journal`): reuses `SCOPE_READ_WALLET` —
  `/wallet/journal` needs no separate scope. Sync pages through
  `getCharacterWalletJournal` (newest-first, per ESI's ordering), storing only
  a small set of tracked `ref_type`s (see `db/repositories/characterWalletJournal.ts`).
  Paging stops on a clearly-partial page (the usual case — most characters fit
  on page 1), once a page's oldest entry is more than 35 days old, or after 10
  pages; ESI 404s a page past the journal's last, so a failed fetch after page 1
  also just ends paging. Enough to always cover "this calendar month" without
  mirroring a character's full trading history.
- **Server status** (`getServerStatus`, no scope): called fresh on every
  Dashboard load (not cached beyond ESI's own `Expires` header) and wrapped in
  a 5-second timeout in `services/dashboardService.ts` so a network hiccup
  degrades the tile to "offline" instead of stalling the whole page.

## Changing scopes

Adding a scope to `ESI_SCOPES` only affects **newly added** characters. Existing tokens
keep their original grant — sync skips the new call for them (`hasGrantedScope`) and the
relevant board shows `scope-missing` with the exact missing scopes until the user re-adds
the character. Also update the app registration at developers.eveonline.com to include
the new scope, or SSO will refuse the authorize request.
