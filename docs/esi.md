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
| `ESI_SCOPES` | skills, skillqueue, location, ship type, implants, clones, fatigue, wallet, structures, online, blueprints, mining (see below). |
| `OPTIONAL_ESI_SCOPES` | Scopes never requested by a plain "Add character" — currently only `esi-corporations.read_blueprints.v1`, opted into per character (see [Opt-in scopes](#opt-in-scopes)). Must still be listed on the app registration. |
| `USER_AGENT` | `MCO/<version> (<contact email>; +repo URL)` — sent on every ESI/SSO/SDE request per CCP best practice. |

Required scopes:

```
esi-skills.read_skills.v1          esi-skills.read_skillqueue.v1
esi-location.read_location.v1      esi-location.read_ship_type.v1
esi-clones.read_implants.v1        esi-clones.read_clones.v1
esi-characters.read_fatigue.v1     esi-wallet.read_character_wallet.v1
esi-universe.read_structures.v1    esi-location.read_online.v1
esi-characters.read_blueprints.v1  esi-industry.read_character_mining.v1
```

Opt-in only (never in the standard grant):

```
esi-corporations.read_blueprints.v1
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
6. **Verify** the access token (`auth/jwt.ts`, see below), then read its claims: `sub`
   gives the character id, `name` the character name, `scp` the **actually granted** scopes.
7. Upsert the character row, persist the refresh token + granted scopes, cache the access
   token. An initial full sync is attempted right away (failure is fine — the scheduler
   retries).

There is no "log in as user" concept — each character is its own token; an account is
just a local grouping bucket (ESI never exposes account membership).

### Opt-in scopes

`startLogin(extraScopes)` appends scopes to the standard `ESI_SCOPES` grant. It exists
for scopes only one or two characters can use, where asking all ~90 for it would be
noise on the consent screen and a pile of 403s at sync time.

The one case today is **corporation blueprints** (Blueprints → "Track alt corp"). An alt
corp — a corporation wholly controlled by one player, used as a shared hangar — holds
blueprints no character token can see. `esi-corporations.read_blueprints.v1` is
requested for a single character, which is then recorded as that corp's **reader**
(`blueprint_corps.reader_character_id`) and is the only token ever used for it. ESI
grants the route only to a character with the **Director** role and answers 403
otherwise; that reason is stored and shown rather than retried (see
`services/blueprintService.ts`). Deliberately none of the rest of corporation
management comes with it — no assets, wallets, members or structures.

Re-running the login for an already-added character just replaces its token family with
a wider-scoped one. Nothing assumes the requested scopes were granted: the stored set is
always read back off the returned JWT's `scp` claim.

## Access-token verification (`auth/jwt.ts`, `auth/jwks.ts`)

Access tokens are verified **at ingress** — as they come back from the token endpoint, in
both `startLogin()` and `refreshAccessToken()`, before a character id, name or scope list
is read out of one. Everything downstream therefore reads claims from a token whose
signature was checked when it was stored, which is why `decodeJwtPayload` can stay
synchronous (`grantedScopes` uses it on an already-stored token).

`verifyAccessToken()` checks, in order:

1. **Algorithm allowlist** — `RS256` and `ES256` only, taken from a table rather than from
   the token. This is the check that matters most: trusting the token's own `alg` is what
   admits `alg: none` and the RS256→HS256 swap where the *public* key becomes the HMAC
   secret. Anything else is rejected before a key is even fetched.
2. **Signature**, against the key the header's `kid` names in the SSO JWKS. The key's type
   must match the algorithm family (an RSA key may not verify an `ES256` header).
3. **Claims** — `iss` is `login.eveonline.com` (the bare-host and `https://` forms are
   normalized so both are accepted), `aud` contains our client_id, `exp` is in the future
   and `nbf` is not, both with 60 s of clock-skew tolerance. A valid signature only proves
   EVE SSO minted the token; `aud` is what proves it was minted for *this* application.

`refreshAccessToken()` additionally binds the token to the character it was requested for
(`sub` must match), so a swapped response cannot overwrite one character's token family
with another's.

**JWKS caching** (`auth/jwks.ts`): the key set is fetched lazily and cached for 12 h, with
parsed `KeyObject`s memoized per kid. With ~90 characters the scheduler can ask for a key
dozens of times a second, so fetches are single-flighted — a burst of refreshes shares one
HTTP request. An unknown `kid` (i.e. key rotation) triggers one refetch, rate-limited to
once per 5 minutes so a bogus kid can't become a request per token. CCP rotates these keys
on the order of years, so if a refetch fails while a cached set exists the cached set is
kept and the failure logged; with no cached set the error propagates and verification
**fails closed** — an unverifiable token is never stored. Login surfaces the reason
(unreachable JWKS, clock skew, bad signature) as user-facing copy rather than the generic
error message.

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

### Paginated routes (`esiGetPaged`)

`esiGetPaged<T>(path, opts)` is the paginated sibling: it returns **every** page's items
concatenated, and each page is an ordinary `esiGet` underneath — its own cache entry, its
own ETag, the same limiter and the same retry budgets. So a 12-page hangar costs 12
requests on the first read and only the changed pages' bodies afterwards.

The loop is bounded by ESI's `X-Pages`, read from page 1 — not by guessing from a short
page or probing for a 404. That distinction is the point: when a stopping rule doubles as
an error handler, a throttle give-up or a 500 reads as "no more pages" and the caller
stores a truncated list (for blueprints, that *deletes* the rows the missing pages
carried). Here a failed page rejects the whole read, so the caller's previous data
survives untouched until the next sync.

`X-Pages` has to survive a cache hit, since a fresh entry skips the response that carried
it — hence the `pages` column on `esi_cache`. A response with no `X-Pages` is a single
page (non-paginated routes send none); a collection that shrinks between page 1 and page
*n* can still 404 mid-read, which propagates like any other failure and resolves on the
next sync.

Two options let a caller read less than everything: `maxPages` (a guard against a
collection of unexpected size, e.g. blueprints cap at 50 pages) and `stopAfter(page, n)`
(the wallet journal stops once a page predates its lookback window). The loop itself lives
in `esi/paging.ts` as `collectPages`, dependency-free so the stopping rules are unit-tested
without Electron, the DB or a network.

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
| `getCharacterWalletJournal` | `/characters/{id}/wallet/journal` | scoped (same scope as `getCharacterWallet`), paginated |
| `getCharacterOnline` | `/characters/{id}/online` | scoped |
| `getCharacterBlueprints` | `/characters/{id}/blueprints` | scoped, paginated |
| `getCharacterMiningLedger` | `/characters/{id}/mining` | scoped (`esi-industry.read_character_mining.v1`), paginated |
| `getCorporationBlueprints` | `/corporations/{id}/blueprints` | scoped **+ Director role** (403 otherwise), paginated |
| `getCorporationPublic` | `/corporations/{id}` | public |
| `getStation` | `/universe/stations/{id}` | public |
| `getPublicStructureIds` | `/universe/structures` | public |
| `getStructure` | `/universe/structures/{id}` | scoped + on the structure's ACL (403 otherwise) |
| `getServerStatus` | `/status/` | public |

New endpoints follow the same shape: define the response interface, add a one-line
wrapper (`esiGet`, or `esiGetPaged` if the route paginates), and call it from a service.

### Finished skill-queue entries

`/characters/{id}/skillqueue` does **not** drop skills once they finish. A completed
skill keeps its slot — original `queue_position`, `finish_date` now in the past — until
the player next edits the queue in game. Read literally, the head of the stored queue is
a long-finished skill, which makes a busily-training character report as idle and pads
the queue with "done" rows the in-game client does not show.

`skills/queue.ts` (pure) trims them: `pendingQueue()` drops every entry whose
`finish_date` has passed, keeping ESI's order and positions. Trimming is done **on read,
not on sync**, so entries fall off the moment they finish rather than lingering until the
next poll — up to an hour later, since the sweep is cache-driven.

Every consumer of `getQueue()` reads through it: training status, the roster's Training /
Time left / Queue left columns, the character sheet's queue card, the group board's queue
summary, and queue-drain notifications. Paused queues are unaffected — EVE clears the
dates while training is paused, and a dateless entry is not a finished one.

### Blueprints

Both blueprint routes are paginated at 1000 entries a page and are plain `esiGetPaged`
wrappers, capped at `BLUEPRINT_MAX_PAGES` (50 — 50k blueprints for one holder). The
service only maps the result into rows: a failed read throws instead of storing a short
list, because the rows replace a holder's stored blueprints wholesale.

Character blueprints ride along with the normal character sync as one more scope-gated
best-effort task in `SYNC_TASKS`. Tracked alt corps are swept once per scheduler tick; because `esiGet`
short-circuits on a fresh cache entry, a corp costs one actual request per ESI cache
window. A corp whose last read failed is skipped for 6 h (`CORP_ERROR_COOLDOWN_MS`)
unless the page's Refresh forces it — a missing Director role will not fix itself within
the hour, and each retry spends an error-limit slot.

`quantity` is the field that separates a BPO from a BPC: **-1 is an original**, -2 a
copy, a positive number a stack of copies. Only originals tick the checklist.

### Dashboard-specific sync notes

- **Online status** (`character_online`, `SCOPE_READ_ONLINE`): fetched once per
  sync, same shape as every other scope-gated best-effort task in
  `characterSync.ts`.
- **Wallet journal** (`character_wallet_journal`): reuses `SCOPE_READ_WALLET` —
  `/wallet/journal` needs no separate scope. Sync reads it through
  `getCharacterWalletJournal` (newest-first, per ESI's ordering), storing only
  the tracked `ref_type`s — ratting/mission income, CONCORD reward payouts,
  player donations, running costs, and anything ending in `_tax` or `_fee`
  (`isTrackedRefType` in `db/repositories/characterWalletJournal.ts`; those two
  are matched by suffix rather than listed because ESI has ~17 of each and gains
  more with every new activity).
  Two things ESI does *not* give you, both verified against a 73-character
  roster's full 30-day journal (2,689 entries): `corporate_reward_payout` arrives
  **net** of the corp's cut with no matching `corporate_reward_tax` row (the
  in-game journal shows both), and across all 2,689 entries only a single `*_tax`
  row came back at all. Tax totals are a floor, not a reconciliation. Each row also keeps ESI's `tax` field (tax withheld at source — a
  taxed bounty pays out net of it) and both party ids, which is what tells a
  donation from another tracked character apart from real outside income.
  It passes `esiGetPaged` a `stopAfter` that ends the read at the page whose
  oldest entry is more than 35 days old, plus a 10-page cap — enough to always
  cover "this calendar month" without mirroring a character's full trading
  history. Most characters fit on page 1, which `X-Pages` says outright.
  **The table is the archive**: ESI's journal reaches ~30 days back, so the
  Wallet page's previous-months view can only show months these sweeps banked.
- **Mining ledger** (`character_mining_ledger`, `SCOPE_READ_MINING`): one more
  scope-gated best-effort task. ESI returns the ledger **already aggregated per
  UTC day, solar system and ore type** and reaching ~30 days back, so unlike the
  wallet journal there is nothing to filter and no "far enough back" to stop at
  — `getCharacterMiningLedger` reads every page (5-page cap; a row is one
  day/system/type bucket, so even a dedicated miner fits in one) and the upsert
  replaces each bucket's quantity, because today's bucket keeps growing and
  every sweep re-reads it. Adding instead of replacing would multiply a day's
  mining by the number of sweeps that saw it.
  **The table is the archive** here too: rows stay after they age out of ESI's
  30-day window, which is what the Mining page's "All" period reads.
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
