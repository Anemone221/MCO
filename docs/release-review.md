# MCO Pre-Release Code Review

Full-codebase review (2026-08-07), aimed at the public release. Scope: every main-process
module (auth, ESI client, sync, services, DB, SDE pipeline), the IPC/preload boundary,
renderer structure, packaging/CI. This builds on [improvement-plan.md](improvement-plan.md)
(2026-07-26) and does not repeat what it already tracks — its remaining open items are
folded into the checklist at the end.

**Overall verdict:** this is an unusually clean codebase for a pre-1.0 tool — strict TS
with no suppressions, real JWT verification with an algorithm allowlist, parameterized SQL
throughout, sandboxed renderer with a CSP, an error boundary that separates user-facing
copy from log truth, and CI that packages and boots the real binary. Nothing here is
rescue work. There is **one high-priority correctness bug** (the token-refresh race, §1.1)
that deserves a fix before strangers run this against their accounts, a handful of
robustness gaps, and some structural investments that will pay off as the feature set
grows.

Severity legend: **P0** fix before public release · **P1** fix soon after / with first
patch · **P2** quality & hardening · **P3** opportunistic.

> **Status (2026-08-08):** every release-blocking item is now done — all of §1
> (correctness) and the shipping-hygiene half of §2.2 (items 1–4 and 6). Verified with
> `typecheck` + `lint` clean, **371 unit tests** passing (up from 341: three new suites for
> the extracted policy modules) and all **18 E2E** cases green against the real app.
> Remaining work is §3–§5 plus the non-code release decisions in §7; see the checklist
> there for what's still open.

---

## 1. Correctness — fix before release

### 1.1 · In-process refresh-token race (P0) — ✅ done

Was: the single-instance lock exists because *"two processes racing a refresh can invalidate
the token family"* ([index.ts:91](../src/main/index.ts#L91)) — but the same race exists
**inside** the process, and the sync engine triggers it on every sweep:

- `syncCharacter` fires skills + skillqueue in one `Promise.all`
  ([characterSync.ts:74-78](../src/main/services/characterSync.ts#L74-L78)); both are
  authed.
- Each authed request independently runs `accessTokenFor` →
  `getValidCachedAccessToken ?? refreshAccessToken`
  ([client.ts:46-48](../src/main/esi/client.ts#L46-L48)). Nothing single-flights the
  refresh.
- On a scheduled sweep the cached access token (~20 min lifetime) is always expired, so
  **both** calls read the *same stored refresh token* and POST it to SSO concurrently.

With rotation, the loser of that race presents an already-consumed refresh token: SSO
answers 4xx → `markTokenInvalid` ([esi-oauth.ts:230-238](../src/main/auth/esi-oauth.ts#L230-L238))
→ the character reads "login expired" even though the winner just stored a perfectly good
token — and if SSO applies standard reuse-detection, the whole family can be revoked. If
this hasn't bitten yet, it's because SSO is currently tolerant of near-simultaneous
exchanges; that is luck, not a contract.

**Fixed** by making one refresh per character the only refresh:

- **[`auth/singleFlight.ts`](../src/main/auth/singleFlight.ts)** — a dependency-free
  `createSingleFlight<K, V>()`: callers arriving for a key already in flight join its
  promise, and the key is released once it settles (so a failure never poisons it and a
  later sweep starts fresh work). The task is invoked inside an `async` wrapper, which is
  what keeps a *synchronous* throw from escaping before the entry is registered and
  wedging the key forever.
- **`refreshAccessToken`** is now a thin single-flight wrapper over the old body (renamed
  `exchangeRefreshToken`), so no call site changed.

Beyond removing the failure mode, this halves SSO traffic on a sweep: one exchange per
character instead of one per concurrent authed request. Covered by
`tests/unit/singleFlight.test.ts` (6 cases, including the sync-throw and
failure-then-retry paths).

### 1.2 · `markTokenInvalid` fires on *any* SSO 4xx (P1) — ✅ done

Was: every 400–499 from the token endpoint meant "refresh token dead", so an SSO blip or
SSO's *own* 429 during a sweep would mark dozens of characters login-expired in one pass —
a wall of red for a user whose tokens are fine.

Now only the OAuth code that actually means it does. `TokenRequestError` moved to
**[`auth/tokenError.ts`](../src/main/auth/tokenError.ts)** (pure, so the judgement is
testable — `esi-oauth.ts` imports Electron and the DB and can't be unit-tested directly),
where it parses the RFC 6749 §5.2 body and exposes `isRefreshTokenRejected`, true only for
`invalid_grant`. Anything else fails the request and logs why, leaving the token alone.
The asymmetry is deliberate and documented at the call site: a false "expired" needs a
manual re-login across the fleet, while a missed one self-corrects on the next successful
refresh. Covered by `tests/unit/tokenError.test.ts` (9 cases).

### 1.3 · Re-login wipes a character's corp/alliance (P2) — ✅ done

Was: the login path upserted `{ id, name }` and `upsertCharacter`'s `ON CONFLICT` clause
wrote the defaulted `null` over `corp_id`/`alliance_id`, so re-running SSO for an existing
character (widening scopes, or `addBlueprintCorp`) blanked its corp until the next sync.

`COALESCE` can't fix this — a character genuinely leaving an alliance and "no data
supplied" both bind as `NULL`, so the SQL can't tell them apart. Split by intent instead:
**`ensureCharacter(id, name)`** touches name only and is what the login path calls;
`upsertCharacter` keeps overwriting corp/alliance and is used where ESI public data is in
hand and authoritative (character sync, blueprint corp registration). Each now says which
it is in its doc comment.

### 1.4 · Scheduler sweeps can overlap (P2) — ✅ done

Was: a bare `setInterval` plus the tray's `runSweepNow`, with nothing stopping a second
sweep starting on top of one still running — entirely possible under sustained 420/429
backoff, where a single request can wait out six 60 s windows. That meant duplicate
fetches, duplicate refreshes (amplifying §1.1) and interleaved `replaceSkills` writes.

Now a module-level `sweepInFlight` promise: `runSweep` returns the running sweep instead of
starting another, and logs that it did. Callers **join** rather than no-op, so the tray's
"Run sync now" still resolves when the work it asked for is actually finished.

### 1.5 · Pagination error handling silently truncates data (P2) — ✅ done

Was: both pagers treated *any* failure after page 1 as "past the last page". The intent
was ESI's real behaviour (404 past the end), but the catch also swallowed a throttle
give-up or a 500-after-retries — and for blueprints the partial list then went to
`replaceCharacterBlueprints`, **deleting the rows the failed pages would have carried**. A
big hangar plus one timed-out request meant blueprints silently vanishing from the board.

Both catches now break only on `err instanceof EsiHttpError && err.status === 404` (and
only past page 1); everything else propagates. The callers already treat blueprint and
wallet-journal syncs as best-effort, so a failed read now leaves the previous data intact
instead of overwriting it with a truncated one. §5.2 has since removed the heuristic
entirely: paging is bounded by `X-Pages`, so there is no 404 probe left to confuse with a
failure, and both `EsiHttpError` catches are gone.

---

## 2. Security

### 2.1 What's already right (no action)

Worth recording so it doesn't get accidentally regressed:

- **Renderer isolation:** `sandbox: true`, `contextIsolation: true`, `nodeIntegration:
  false` ([index.ts:55-60](../src/main/index.ts#L55-L60)); typed `contextBridge` surface;
  CSP restricting `connect-src 'self'` and images to `images.evetech.net`.
- **OAuth:** PKCE S256 with crypto-random verifier/state; loopback listener bound to
  `127.0.0.1`; state checked before the code is accepted.
- **JWT verification at ingress** with an algorithm allowlist (blocks `alg:none` and the
  RS256→HS256 swap), key-type cross-check, `iss`/`aud`/`exp`/`nbf` claims, and `sub`
  bound to the requested character on refresh. JWKS fetch single-flighted, fail-closed
  when no cached set exists.
- **Refresh tokens encrypted** via `safeStorage`, failing closed when OS encryption is
  unavailable.
- **SQL:** 100 % prepared statements; both `LIKE` search paths escape `%`/`_` with an
  explicit `ESCAPE` clause.
- **Error hygiene:** internal messages never reach the UI (`toUserMessage`); full truth
  goes to the captured log.

### 2.2 Hardening for a public build (P1–P2)

None of these was an exploitable hole, but they're the standard belt-and-braces for an
Electron app leaving the developer's machine. **Items 1–4 and 6 are done**; the rest stay
open.

1. **Allowlist `shell.openExternal`** (P1) — ✅ done. Was: the window-open handler
   forwarded *any* URL to the OS, so anything that could put a URL on the page could
   launch a local protocol handler (`file:`, the `ms-*:` family). Now gated on
   `isSafeExternalUrl`, and a refusal is logged rather than silent.
2. **Deny navigation** (P1) — ✅ done. A `will-navigate` handler now `preventDefault()`s
   anything that isn't the document MCO loaded, closing the "renderer navigated to a
   remote page that now runs against your preload bridge" class outright. React-router
   navigates via the history API and never raises this event, so in-app routing is
   unaffected — confirmed by the 18 E2E cases, which page through the whole nav.
3. **Deny permission requests** (P2) — ✅ done. `setPermissionRequestHandler` refuses
   everything: MCO's UI needs no camera, microphone, geolocation, or web Notification
   permission (toasts are raised from the main process).

   The policy for 1 and 2 lives in **[`webSecurity.ts`](../src/main/webSecurity.ts)** as
   two pure predicates rather than inline in `index.ts`, so it's asserted by tests instead
   of by reading the window setup — `tests/unit/webSecurity.test.ts`, 12 cases including
   the `file:` opaque-origin trap, where every local file would otherwise compare
   same-origin with every other.
4. **Don't reject a pending login on a bad callback** (P2) — ✅ done. Was: a mismatched
   `state` rejected the whole login and closed the server, so any local process could kill
   a sign-in by hitting `http://127.0.0.1:8765/callback?state=x`. Now such a request is
   answered 400 and **ignored**, with the listener left up for the genuine redirect. The
   same change made the listener cancellable: `awaitCallback` returns a `close()` handle,
   and `startLogin` calls it if `shell.openExternal` throws — previously a browser that
   never opened held the port for the full five-minute timeout.
5. **Stop persisting plaintext access tokens** (P2). `tokens.access_token` stores the
   short-lived JWT unencrypted; a copied `mco.sqlite` leaks up-to-20-minute-valid tokens
   for every character. They're cheap to re-derive — hold the access-token cache in a
   main-process `Map` instead of the DB (the refresh token, which *is* encrypted, is the
   durable credential). This also simplifies `grantedScopes`' "decode the stored JWT"
   dance.
6. **Remove the manual `Host` header** in `postToken` — ✅ done. `fetch` derives it from
   `SSO_TOKEN_URL`; pinning it by hand was redundant and would have become a mismatch to
   hunt down if that URL ever moved.
7. **Cap renderer-supplied string lengths** (P3). Tag/group/account names and pasted
   fit/plan text go into the DB unvalidated. Nothing breaks, but a 10 MB "tag name" is
   silly to allow; a `trim().slice(0, N)`-with-error in the create/rename repo functions
   is enough. (IPC arg *types* are already effectively safe: ids flow into prepared
   statements as parameters.)
8. **SDE download integrity** (P3). The zip is fetched over TLS from CCP but never
   length-checked — compare received bytes to `Content-Length` before import, and add an
   abort timeout to the fetch ([downloader.ts:26](../src/main/sde/downloader.ts#L26) has
   none, so a stalled CDN connection hangs the import forever with no way to cancel).

---

## 3. Robustness

### 3.1 · `esi_cache` grows forever (P2)

Every URL ever fetched keeps its last body forever — including per-page wallet-journal
URLs, the full `/universe/structures` id list, and every URL of a character that has since
been **removed** (`removeCharacter` deletes the character; cache rows are keyed by URL and
survive). On a 93-character profile that's slow, unbounded growth of the profile DB. Add a
startup (or per-sweep) purge: `DELETE FROM esi_cache WHERE expires_at < datetime('now',
'-30 days')`, plus a targeted `DELETE ... WHERE url LIKE '%/characters/<id>/%'` in
`removeCharacter`.

### 3.2 · SDE import is not atomic (P2)

Each `replaceX` runs in its own transaction
([sde.ts](../src/main/db/repositories/sde.ts)), so a failure mid-import (corrupt zip,
disk-full, crash) leaves *mixed* SDE state — new categories with old types, or skill reqs
from one build against types from another. The version stamp is correctly written last, so
it won't lie, but the data can. The importer already buffers most files fully; finish the
thought: parse **everything** into memory first, then apply all `replaceX` calls plus
`setSdeVersion` inside one `db.transaction`. better-sqlite3 transactions are synchronous,
which is exactly what the current structure (async parse → sync writes) allows if the
writes are grouped at the end — `replaceTypes` is already deferred that way.

### 3.3 · Duplicated magic URL for "due" checks (P2)

`isCharacterDue` ([characterSync.ts:368](../src/main/services/characterSync.ts#L368)) and
`buildSyncStatus` ([settingsService.ts:28](../src/main/services/settingsService.ts#L28))
both hand-build `${ESI_BASE_URL}/characters/${id}/skills` and must match
[endpoints.ts:49](../src/main/esi/endpoints.ts#L49) *character-for-character* — a trailing
slash added in one place would silently make every character permanently "due" (hourly
full-fleet sweeps) with no error anywhere. Export a `characterSkillsUrl(id)` helper from
`endpoints.ts` and use it in all three places.

### 3.4 · Migration safety net for public users (P2)

Migrations are transactional per-step and the downgrade guard is excellent — but once
strangers' profiles are at stake, take a pre-migration backup: when `pending.length > 0`,
copy `mco.sqlite` to `mco-pre-v<N>.sqlite` (or use `db.backup()`) before applying. A buggy
*future* migration then costs an apology instead of a profile. Cheap, and it composes with
the crash-report story you already have.

### 3.5 · Renderer crash still shows a blank window (P2 — carried over)

Already flagged at the end of improvement-plan B3, still open: handle
`render-process-gone` / `webContents.on('unresponsive')` with at least a "MCO's window
crashed — reload?" dialog (`webContents.reload()`), mirroring the main-process crash
handler's spirit.

### 3.6 · Smaller notes (P3)

- `APP_VERSION` in [config.ts:94](../src/main/config.ts#L94) duplicates
  `package.json`'s `version` and they *will* drift on the first release bump. Use
  `app.getVersion()` (reads package.json / the packaged metadata) as the single source and
  derive `USER_AGENT` from it at startup.
- `getSchedulerStatus`'s next-sweep ETA assumes `setInterval` fired on schedule; after a
  laptop sleep the displayed ETA can be in the past. Harmless — just be aware it's an
  estimate, or clamp to `now` when rendering.
- `resolveTypeIdsByName`'s `IN (...) COLLATE NOCASE` can't use `idx_sde_types_name`; with
  the JS-side lowercase fallback already there, the SQL could drop `COLLATE NOCASE` (exact
  match, indexed) and let the fallback handle case. Only matters for very large plans;
  fine to skip.

---

## 4. Simplifications

### 4.1 · One data-loading hook instead of 16 hand-rolled copies (P2, big win) — ✅ done

Was: every page independently implemented the same machine — `useState` for data + error
(+ loading), a `load()` callback, a mount effect, often an `mco.characters.onChanged`
subscription, and `errorMessage(err)` in the catch, across 16 pages in two incompatible
dialects (six threw out of `load` and caught in the effect, with no `loading` state and an
error that never cleared; ten owned a try/catch/finally, and `GroupDetail` forgot its
`setError(null)`).

Now: [useMcoData.ts](../src/renderer/src/lib/useMcoData.ts) —

```ts
const { data, error, loading, reload, setData, setError } = useMcoData(load, {
  deps: [fitId],            // re-load when a route param changes
  onCharactersChanged: true // re-load when a sync sweep lands
});
```

All 16 pages call it. Across `pages/`, uses of
`useState`/`useEffect`/`useCallback`/`errorMessage`/`onChanged` dropped from 250 to 123,
and Dashboard, Wallet and CharacterDetail now reach zero — they are pure view code.
`data` is `null` until the first load resolves, so a multi-source page returns an
object and destructures with defaults
(`const { roster = [], tags = [] } = data ?? {};`). Two behaviours the copies didn't share
are now uniform: the error box clears at the start of every run, and a superseded run is
discarded rather than raced — a sweep firing mid-load, StrictMode's double mount and a fast
route change can no longer land stale data. It also fixed Settings' "Sync all now"
partial-failure message, which the old ordering (`setError` then `load()`) wiped before it
could render.

`load` is read from a ref, so an inline arrow cannot spin the effect —
`react-hooks/exhaustive-deps` is not enabled, so requiring `useCallback` would have been a
footgun for the next page. `NotificationBell` and `SdeBanner` stay outside: they stream
(`notifications:changed`, `sde:progress`) rather than fetch.

Not done, and still open: the five near-identical `run(action)` mutation runners
(Accounts, Tags, Groups, Roster, GroupDetail) are the other half of this duplication. They
now call the hook's `reload`/`setError`, but a `useMcoAction` extraction is its own change.

### 4.2 · Split `GroupDetail.tsx` (P3) — ✅ done

Was: 1,020 lines (956 after §4.1), ~2× the next-largest page, with ten in-file
sub-components ahead of the page itself.

**`GroupDetail.tsx` is now 231 lines** and is composition only — toolbar, priorities card,
pod section, member checklist, member grid. Five components moved out:

| New file | Holds |
| --- | --- |
| [components/HomeStationPicker.tsx](../src/renderer/src/components/HomeStationPicker.tsx) | structure type-ahead for the group's home station |
| [components/PodSystemPicker.tsx](../src/renderer/src/components/PodSystemPicker.tsx) | solar-system type-ahead for the whitelist |
| [components/PodWhitelistSection.tsx](../src/renderer/src/components/PodWhitelistSection.tsx) | the section + its private `PodLabel` / `PodViolationRow` / `PodIgnoreMenu` / `PodIgnoredRow` |
| [components/MemberCard.tsx](../src/renderer/src/components/MemberCard.tsx) | the member card + its private `QueueLine` / `ObjectiveBar` |
| [components/EsiActivityPanel.tsx](../src/renderer/src/components/EsiActivityPanel.tsx) | Settings' ESI-health panel + its event labels |

The review named the pickers and the pod section; `MemberCard` went too, because leaving
170 lines of card rendering behind would not have left the page as *composition*.
`Settings.tsx` is 581 → 466 — it was touched by §4.1, which is the trigger this item named.
No page is now over ~500 lines and the largest is Roster, not GroupDetail.

One duplication surfaced by the split and removed:
[useDebouncedSearch.ts](../src/renderer/src/lib/useDebouncedSearch.ts). Both pickers had
the same 18-line effect — trim, 2-char minimum, 200 ms debounce, `cancelled` flag — so it
became a hook next to `useMcoData`, and each picker is now its own markup plus one call.
It also catches a rejected search (the two copies didn't, so a failed type-ahead raised an
unhandled rejection); a failure now reads as "no matches", which is what the picker's empty
copy already explains.

Nothing else changed: every `data-testid` moved verbatim, and the E2E group case —
which drives the pod whitelist's toggle, both tabs and both empty states — passes untouched.

### 4.3 · Preload boilerplate (P3) — ✅ done

Was: ~60 hand-written `(...args) => invoke(channel, ...args)` forwarders plus four copies
of the `ipcRenderer.on` / `removeListener` subscribe dance, half of them wrapping onto a
second line for no reason but width.

Now two factories in [preload/index.ts](../src/preload/index.ts):

```ts
characters: {
  detail: call(IpcChannel.charactersDetail),      // types come from McoApi
  onChanged: subscribe(IpcChannel.charactersChanged),
},
sde: { onProgress: subscribe<SdeProgress>(IpcChannel.sdeProgress), … },
```

`call<A, R>` takes only the channel: the argument and return types are inferred from the
contextual type of the `McoApi` member being assigned, so `McoApi` stays the single
description of the surface and the channel is the one thing still written by hand.
`subscribe<P>` registers the listener and returns its remover (payload-less events default
to `P = void`). The `api` object went 142 → 109 lines with every member now on one line;
the file is 167 → 157 overall, the difference being that the two factories carry an
explanation the 60 arrows never did.

One thing the rewrite pinned down: the scattered `color ?? null` was **load-bearing**, not
decoration — `tags.create`, `groups.create` and `accounts.create` are all called with the
optional argument omitted ([Accounts.tsx:106](../src/renderer/src/pages/Accounts.tsx#L106)
and friends), and the main handlers all declare theirs `T | null` on the way to a prepared
statement. It is now one documented rule inside `call` (undefined crosses as `null`)
instead of a per-site habit the next channel could forget.

Not addressed here: the four-file touch per new channel (`IpcChannel` → `McoApi` → preload
→ the handler) is the real cost, and this removes only the preload quarter of it — §5.4
took the register half.

---

## 5. Rework now to make expansion cheap

### 5.1 · Turn `syncCharacter` into a task registry (P1 for the architecture, not a bug) — ✅ done

Was: a 180-line straight-line function where every data domain repeated the same stanza —
*optional scope gate → fetch → map → upsert → warn-don't-throw* — nine times over, so
adding assets, contracts, industry jobs or LP balances meant a tenth copy, and adding
anything *uniform* (per-task freshness, per-task reporting on the Settings page) meant
editing all nine.

Now the domains are data and the loop is the only control flow
([characterSync.ts](../src/main/services/characterSync.ts)):

```ts
interface SyncTask {
  name: string;      // subject of the failure line
  scope?: string;    // gate; omitted for base-scope data
  critical?: boolean; // aborts the sync; everything else warns
  run: (ctx: SyncContext) => Promise<void>;
}
const SYNC_TASKS: SyncTask[] = [ /* Skills, Location, Implant, Clone, Fatigue,
   Wallet, Wallet journal, Blueprint, Online-status, Attribute */ ];
```

`syncCharacter` is **37 lines** and owns what the nine copies each re-stated: the scope
gate, the try/catch, the failure line, the ordering, and the structure-resolution epilogue.
A task's `run` is now only fetch-and-store. Three details the extraction had to get right:

- **`SyncContext.noteStructure`** replaces the `structureIds` array two stanzas pushed to
  directly. Tasks report the player-owned structures they saw; the driver resolves them
  once at the end with the character's token, as before.
- **The critical head stays one task, not three.** Public info, skills and queue are
  fetched in one `Promise.all` and stored only once all three land — splitting them into
  three tasks would have quietly allowed a half-read sync to store a fresh queue against
  last hour's skills.
- **Scopes are read once per sync, not once per gate.** `grantedScopes` is a DB read plus
  a JWT decode and was called six times per character (~560 per sweep at 93 characters).
  The driver memoizes it on first use — which is *after* the critical task, so it still
  reads the access token that task's refresh just stored, and a grant can only widen
  through a fresh login, which rewrites the row outright.

Behaviour is otherwise unchanged by construction: same task order, same sequential
execution, same warn text (`<name> sync failed for character <id>`), same best-effort vs
fail-the-sync split.

Still pairs with improvement-plan C1 (DB-backed tests) — and the pairing is now the
blocking direction. `characterSync.ts` reaches Electron and the DB transitively, so nothing
here is unit-testable today; `typecheck`, `lint`, 371 unit tests and the 18 E2E cases all
pass, but **none of them executes a sync** (a throwaway E2E profile has no characters, so
E2E confirms the module graph boots and nothing more). The registry is what makes each task
independently testable against a temp DB once C1 lands.

### 5.2 · Give the ESI client a paged variant (P2) — ✅ done

Was: `esiGet` hid every response header, so both paginated consumers reinvented stopping
rules ("short page", "404 probe", hard caps) — and since the 404 rule doubled as an error
handler, §1.5's truncation bug was structural rather than incidental.

Now `esiGetPaged<T>(path, opts): Promise<T[]>` sits beside `esiGet`, both thin wrappers over
one internal request function that returns `{ data, pages }`. The loop it drives is
[esi/paging.ts](../src/main/esi/paging.ts) — `collectPages`, dependency-free and therefore
unit-tested (7 cases, no Electron/DB/network): fetch page 1, read `X-Pages`, fetch the rest,
concatenate. Nothing is inferred from a failure any more; a failed page rejects the read, so
the caller keeps the data it already had. Three details:

- **`X-Pages` had to become durable.** A fresh cache hit skips the response that carries it,
  and "no header" would then read as "one page" — the exact truncation, now on the cache
  path. Migration **v29** adds `esi_cache.pages` and drops the paginated entries cached
  before it existed (a NULL there would be indistinguishable from a single-page route).
  A 304 keeps the stored count when it doesn't repeat the header.
- **What stayed a caller's business is exactly two knobs.** `maxPages` (a size guard, not a
  stopping rule: blueprints cap at 50) and `stopAfter(page, n)` — the wallet journal's real
  domain rule, "stop once a page predates the 35-day window". Its old partial-page heuristic
  is gone outright.
- **The consumers collapsed as advertised.** `pageBlueprints` (30 lines of loop) is now a
  `toOwnedRows` mapper; `syncWalletJournal` lost its page loop, its `EsiHttpError` import and
  a constant. `endpoints.ts` owns the page-count cap, so the services read as fetch-and-store.

The next paginated endpoint — assets, *the* obvious future feature for this user base — is a
one-liner. `typecheck`, `lint` and 378 unit tests pass; as with §5.1, nothing here executes
against a live ESI until C1 lands, but the loop is now the tested part.

### 5.3 · Notification pipeline skeleton (P3) — ✅ done (ahead of kind #2, deliberately)

Was: `notificationService` was queue-drain-specific, but the shape — *candidates → pure
`findX` rule → dedupe-keyed insert → toast + `notificationsChanged`* — is exactly what
fatigue-expired, extractor-ready, or plan-complete notifications will need.

This section said to wait for kind #2 so the seam would be cut against two examples
instead of one. **That advice was overridden on 2026-08-09** — the extraction was done on
its own, with no second kind. Recorded plainly because it changes what the next kind has
to check: the seam has one caller, so the first real second kind should be treated as a
test of where the line falls, not as a slot to fill.

[notificationDelivery.ts](../src/main/services/notificationDelivery.ts) now owns the half
every kind shares — dedupe-keyed insert, one `notificationsChanged` ping, an OS toast per
notification that was actually new, and the tray-aware click handler.
`checkQueueDrainWarnings` keeps what is genuinely queue-drain's: the DB reads that build
candidates, the pure rule, and the sentence. Two notes:

- **The ping is now one per batch, not one per notification.** The bell reloads the whole
  list on the event, so the old per-notification sends were N identical reloads. The only
  intentional behaviour change here.
- **`PendingNotification.dedupeKey` is where the doc-comment weight went.** It is the
  identity of the *occurrence*, and getting it wrong is how a kind either notifies twice
  or never notifies again — the one thing a new kind can quietly get wrong.

Still untested for the same reason as §5.1: the deliverer reaches Electron's `Notification`
and the DB, so C1 is what would cover it. The pure rule beside it stays testable, which was
the point of the split. `typecheck`, `lint`, 378 unit tests and 18 E2E cases pass.

### 5.4 · IPC surface scaling (P3) — ✅ done

Was: ~60 channels × 4 touch-points each, with the register quarter concentrated in one
295-line file — a 300-line function behind an 80-line import header, where every new
channel landed in the middle and every feature branch touched the same lines.

Now 69 handlers across 13 modules in [ipc/channels/](../src/main/ipc/channels), split on
the domains `McoApi` is *already* grouped by, so the two halves of a channel live at the
same address on both sides of the bridge. [register.ts](../src/main/ipc/register.ts) is a
composition root: thirteen calls and the coverage check. Three judgement calls worth
recording:

- **Modules, not sections of one file.** The doc suggested per-domain *functions*; the
  import header is what actually doesn't scale, and only a real split fixes it. A new
  domain (assets) is now a new file plus one line, and feature branches stop colliding.
- **`getWindow` is passed only where it's used** — sde, universe, system, settings — so the
  signature is a list of which domains can reach the window. A uniform context object would
  have hidden that to save four characters.
- **`handle()` moved to [ipc/handle.ts](../src/main/ipc/handle.ts).** It was a private
  helper in the file it now serves thirteen of; the error-boundary rationale moved with it.

**Beyond the section's text:** splitting made a new mistake possible — a registrar that is
written but never called wires nothing, and the symptom (`No handler registered`, on one
page, at click time) is nowhere near the cause. So `registerIpc` now ends by comparing what
`handle()` actually wired against every declared channel bar the push-only ones
([coverage.ts](../src/main/ipc/coverage.ts) + `IPC_EVENT_CHANNELS`), and **throws
unpackaged** — dev and E2E — while a packaged build logs instead, because one broken page
beats refusing to start. The set arithmetic is pure and unit-tested (5 cases); E2E boots
the real app, so the check runs for real on every suite run.

Behaviour is otherwise unchanged: same channels, same handler bodies, same error boundary.
`typecheck`, `lint`, **383 unit tests** and 18 E2E cases pass. Full schema-driven generation
(deriving preload + register from one table) remains possible and still isn't worth the
indirection at this size.

### 5.5 · `shared/types.ts` (P3)

816 lines and growing with every feature. When it next needs surgery, split by domain
(`types/roster.ts`, `types/blueprints.ts`, …) re-exported from an index — purely
mechanical, zero behaviour risk, and it keeps merge conflicts local as features multiply.

---

## 6. Performance at 90+ characters

Nothing alarming. `buildRoster` does 2 queries per character (`getTotalSp`, `getQueue`) —
~200 prepared-statement hits per roster load, which better-sqlite3 serves in single-digit
milliseconds in-process; not worth batching until measured otherwise (and
[optimization.md](optimization.md) already tracks the read paths). The rate limiter's
120 ms pacing / 20-slot cap / wave-of-8 sweep design is genuinely good and matches CCP's
published guidance. The one perf item worth doing is §3.1 (cache growth), which is a disk
concern more than a speed one.

---

## 7. Release checklist (merged with improvement-plan.md)

**Done (2026-08-08) — all code-side release blockers:**

1. ~~**§1.1 refresh single-flight**~~ — the one change worth holding a release for.
2. ~~**§2.2.1–3 openExternal allowlist, navigation deny, permission handler**~~ — standard
   Electron ship hygiene.
3. ~~**§1.2 / §1.3 / §1.4 / §1.5**~~ — the contained correctness fixes.
4. ~~**§2.2.4 / §2.2.6**~~ — SSO callback listener hardening and the stray `Host` header.

Landed as five focused modules plus edits: `auth/singleFlight.ts`, `auth/tokenError.ts`
and `webSecurity.ts` are new and pure, which is what let all three be covered by tests
(27 new cases, 371 total) rather than asserted by inspection. `typecheck`, `lint` and the
18-case E2E suite are green.

**Still open, in suggested order:**

5. **A3 (signing decision)** — from the improvement plan; unsigned NSIS means SmartScreen
   for every user. Decide and write it down either way. *This is now the only thing
   between the current tree and a defensible public release* — it's a decision, not code.
6. **macOS/Linux `npm run dist` smoke** — still never been built. Ship Windows-only
   explicitly if you don't test them; a README line beats a broken dmg.
7. **C1 DB-backed tests** — the repositories/services layer remains the only untested
   layer, and future migrations want the safety net. This moved up the list now that
   §5.1 has landed: the sync registry was rewritten with nothing able to execute it, and
   it is what makes each task testable against a temp DB. §1.3's `ensureCharacter` split
   and §1.5's replace-after-partial-read fix are the same kind of thing such a suite
   would pin down.
8. Post-release: §3.x robustness (§3.1 cache growth and §3.2 atomic SDE import are the two
   with user-visible consequences), auto-update (improvement plan D) once distribution
   settles. (§4.1's hook is done; its `useMcoAction` half is the leftover. §4.3 and all of
   §5.1–§5.4 are done; §5.5 remains, by its own "when it next needs surgery" trigger.)

Recorded, not scheduled: §2.2.5 access-token storage, §2.2.7–8 input caps and SDE download
integrity, §3.4 pre-migration backup, §3.5 renderer-crash handling, §5.3–5.5 structure prep.
