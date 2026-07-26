# MCO Code Style Guide

This document codifies the conventions **already in use** across the MCO codebase. It is
descriptive, not aspirational — every rule here reflects a pattern the existing code
follows consistently. New code should match it so the codebase keeps reading as if one
person wrote it.

It complements [`CLAUDE.md`](../CLAUDE.md) (architecture + invariants) and the
[`docs/`](README.md) set. Where CLAUDE.md states an invariant, this guide explains how it
shows up in day-to-day code.

---

## 1. Formatting

Enforced by Prettier (`.prettierrc.json`) — run `npm run format`. Don't hand-format.

| Setting | Value |
| --- | --- |
| Quotes | single (`'…'`) |
| Semicolons | required |
| Trailing commas | `all` |
| Print width | 100 |
| Indent | 2 spaces |
| Arrow parens | always (`(x) => …`) |

ESLint (`eslint.config.mjs`) is the correctness gate on top of formatting. The bar the
current tree clears and new code must hold:

- **Zero `any`.** There is not a single `: any` or `as any` in `src/`. Model the type.
- **Zero suppressions.** No `@ts-ignore`, `@ts-expect-error`, or `eslint-disable`.
- **Unused args** are prefixed `_` (e.g. `(_event, id) => …`) — that's the only escape
  hatch `no-unused-vars` allows.

TypeScript is `strict`. Two projects compile: `tsconfig.node.json` (main + preload +
shared) and `tsconfig.web.json` (renderer + shared). `npm run typecheck` runs both.

---

## 2. Naming

- **Files:** `camelCase.ts` for modules (`characterSync.ts`, `rateLimiter.ts`),
  `PascalCase.tsx` for React components (`Roster.tsx`, `CharacterAvatar.tsx`). Hooks are
  `useX.ts` (`useAmChart.ts`, `useCountUp.ts`).
- **Types/interfaces:** `PascalCase`, no `I` prefix (`RosterEntry`, `EsiDataStatus`).
- **Functions/vars:** `camelCase`. Verbs for actions (`buildRoster`, `syncCharacter`,
  `resolveStructures`); `getX`/`listX` for reads; `upsertX`/`replaceX`/`removeX` for
  writes.
- **Constants:** `SCREAMING_SNAKE_CASE` for tuned/magic values, always with a comment
  explaining the number (`SWEEP_WAVE_SIZE = 8`, `THROTTLE_FALLBACK_SECONDS = 60`).
- **Numeric literals** use `_` separators for readability (`30_000`, `1_000_000`,
  `60 * 60 * 1000`).
- **Repository read/write verbs are a vocabulary** — reuse them: `list*` (all rows),
  `get*` (one, or a `Map` for batches), `replace*` (delete-then-insert a set),
  `upsert*`, `touch*` (bump a timestamp), `remove*`.

---

## 3. The two-name boundary (ESI/SQL ⇄ app)

MCO speaks three vocabularies and converts at the edges, never in the middle:

1. **ESI JSON** — `snake_case` (`solar_system_id`, `jump_fatigue_expire_date`). Typed
   with local interfaces at the fetch site (`endpoints.ts`), consumed immediately.
2. **SQLite columns** — `snake_case` (`character_id`, `finish_level`). Each repository
   read declares a private `*DbRow` interface for the raw shape, then maps it to camelCase.
3. **App/view models** — `camelCase`, defined in `src/shared/types.ts`. This is the only
   vocabulary the renderer ever sees.

The mapping happens **inside the repository/service that owns the boundary**. Example
(`repositories/skills.ts`):

```ts
interface QueueDbRow { skill_type_id: number; finish_level: number; /* … */ }

export function getQueue(characterId: number): QueueRow[] {
  const rows = getDb().prepare('SELECT … FROM skill_queue …').all(characterId) as QueueDbRow[];
  return rows.map((r) => ({ skillTypeId: r.skill_type_id, finishLevel: r.finish_level, /* … */ }));
}
```

Never let a `snake_case` field escape into a service return value or a React component.

---

## 4. Types & nullability

- **`null` is a value with meaning, and the meaning is documented.** The codebase uses
  `null` (not `undefined`) for "absent" in view models, and every nullable field carries a
  doc comment saying *why* it can be null and what null means. See `RosterEntry` in
  `types.ts` — `jumpFatigue: … | null` is commented "null when unknown (never synced /
  scope not granted)".
- **Distinguish "absent" from "why absent."** When the *reason* matters to the UI, model
  it explicitly rather than overloading `null`. The canonical pattern is the reusable
  `EsiDataStatus = 'ok' | 'pending' | 'scope-missing' | 'login-expired'` union — the UI
  says *why* data is missing instead of showing an error. Reuse it for any scope-gated
  feature; don't invent a parallel status enum.
- **String-literal unions over enums** (`kind: 'active' | 'jump-clone'`, `EsiEventKind`).
- **`as const`** for lookup objects and channel maps (`IpcChannel`, `ESI_SCOPES`).
- **Discriminated/optional fields**: prefer a small nested object (`{ expireDate: string |
  null } | null`) when a group of fields shares one "present/absent" fate.
- Every exported type in `shared/types.ts` gets a doc comment describing what it feeds
  (which page/tile/chart). Keep that habit — it's how the contract stays legible.

---

## 5. Comments: explain *why*, and the EVE-specific gotcha

This is the codebase's signature. Comments almost never restate what the code does; they
capture the reasoning, the domain rule, or the failure that motivated the code. Match this.

Good comment shapes seen throughout:

- **The EVE domain rule** — "EVE SSO rotates refresh tokens on every refresh, so two
  processes racing a refresh can invalidate the token family and deauth a character."
- **The tuned constant's rationale** — "~8 requests/second steady-state — gentle, and
  drains a full-fleet sweep in ~2 min."
- **The bug this prevents** — "Windows can leave the page unfocused after a native modal
  closes." / "Firing all 90+ characters at once dumped ~1k requests into ESI in a single
  burst — enough transient errors … to trip the error limit (420)."
- **The deliberate scope boundary** — "this only needs to guarantee coverage of the
  current calendar month, not full history."

JSDoc `/** … */` on every exported function/type; short `//` notes inline for the tricky
step. If a number is tuned, a comment says what it's tuned against. Leave a `TODO:` only
with a concrete follow-up (there is exactly one in the tree — the JWT-signature note).

---

## 6. Process layering (the hard rule)

The dependency direction is one-way and enforced by convention + `externalizeDepsPlugin`:

```
renderer (sandboxed React)
  → window.mco  (preload/index.ts: typed McoApi over ipcRenderer.invoke)
    → IpcChannel (shared/ipc.ts: string-const map + McoApi interface)
      → ipc/register.ts (one ipcMain.handle per channel, thin)
        → services/*   (compose ESI + SDE + DB into view models)
          → repositories/*  (the ONLY code that runs SQL)
          → esi/client.ts (the ONLY code that fetches ESI)
```

Rules that keep this intact:

- **Renderer imports nothing from `src/main`.** It imports `@shared/types` and
  `@shared/ipc` (types only) and calls `window.mco` (via `lib/ipc.ts`).
- **Adding a feature = add a channel in three places**: `shared/ipc.ts` (channel const +
  `McoApi` method), `preload/index.ts` (the `ipcRenderer.invoke` wrapper),
  `ipc/register.ts` (the handler). Keep the handler a one-liner that delegates to a
  service/repository.
- **`register.ts` handlers stay thin.** Business logic lives in a service; SQL lives in a
  repository. A handler that does more than unwrap args and call one function is a smell.
- **Repositories never call services or ESI.** Services orchestrate; repositories persist.
- **Pure logic has no imports from `electron`, `better-sqlite3`, or a service.** Parsers,
  analysis math, filtering/sorting live in dependency-free modules (`fits/`, `plans/`,
  `clones/`, `wallet/`, `renderer/src/lib/`) so they're unit-testable in isolation.

---

## 7. ESI & async conventions

- **All ESI GETs go through `esiGet`** (`esi/client.ts`). Never `fetch` an ESI route
  directly — `esiGet` owns caching (ETag/Expires), token refresh, the rate limiter, retry
  budgets, and instrumentation. New endpoints are one-line wrappers in `esi/endpoints.ts`.
- **Two independent give-up budgets.** Transient failures (5xx/network/timeout) spend
  `MAX_RETRIES`; throttling (420/429) spends `MAX_THROTTLE_WAITS`. Don't collapse them —
  waiting out a shared backoff must not burn the transient budget.
- **Best-effort sub-syncs never fail the whole sync.** In `syncCharacter`, each optional
  data pull (location, clones, fatigue, wallet, online, attributes) is wrapped in its own
  `try/catch` that `console.warn`s with character context and continues. Only the core
  (public info + skills + queue) is allowed to throw.
- **Scope-gate before you call.** Guard scope-dependent fetches with
  `hasGrantedScope(characterId, SCOPE_…)` so you don't fire requests ESI will 403.
- **Fan-out is waved, not bursted.** Batch work over a large fleet goes through
  `Promise.allSettled` in waves (`SWEEP_WAVE_SIZE`) with jitter, so a 90-character sweep
  de-bursts. Collect per-item `SyncResult`s; never let one failure abort the batch.
- **`void` the promise you intentionally don't await** (`void run(…)`, `void
  load().catch(…)`), and always attach a `.catch` when you fire-and-forget in the renderer.

---

## 8. Database conventions

- **One migration per schema change, append-only.** Add a `{ version, name, sql }` to the
  `MIGRATIONS` array in `db/migrations.ts`; never edit an applied migration. Migrations run
  inside a transaction each. `LATEST_SCHEMA_VERSION` is derived, not hand-maintained.
- **Comment non-obvious tables** with what they store and the domain reason (see the
  `structures`, `group_pod_ignores`, `character_wallet_journal` migration comments).
- **Writes that replace a set use delete-then-insert in one transaction** (`replaceSkills`,
  `replaceQueue`): prepare `del` + `ins` once, wrap in `db.transaction(() => …)()`.
- **Foreign keys are on** (`PRAGMA foreign_keys = ON`); use `ON DELETE CASCADE` for owned
  child rows and `ON DELETE SET NULL` for soft references (see `characters.account_id`).
- **Index what you filter/join on**, and denormalize a name when display would otherwise
  need a lookup (documented convention: `group_pod_systems.system_name`,
  `PodSystemEntry.systemName`).
- Timestamps are ISO-8601 strings (`datetime('now')` defaults, `.toISOString()` in code),
  never epoch numbers.

---

## 9. React / renderer conventions

- **Pages fetch view models; they don't compute them.** A page calls `mco.*`, stores the
  result, and renders. All non-trivial derivation (filter/sort/summarize/threshold) lives
  in a `lib/*View.ts` module and is unit-tested (`rosterView.ts`, `groupView.ts`,
  `costView.ts`). Pages `useMemo` over those pure functions.
- **Import `mco` from `lib/ipc.ts`, not `window.mco`.** The `lib/ipc` wrapper applies the
  demo-mode scrub; a page that reaches for `window.mco` bypasses it.
- **Subscribe + reload for background updates.** The `onChanged`/`onProgress` channels
  return an unsubscribe function; call it from the `useEffect` cleanup. Pattern:
  ```ts
  useEffect(() => {
    void load().catch((e: unknown) => setError(String(e)));
    return mco.characters.onChanged(() => void load().catch(…));
  }, [load]);
  ```
- **One `busy` string, one `error` string** per page for action state (`busy === 'add'`),
  rather than a boolean per button. Disable actions while `busy !== null`.
- **Never `window.confirm`.** Use `mco.system.confirm` — the synchronous native dialog
  desyncs Chromium's focus and breaks text input (documented in `McoApi.system.confirm`).
- **`data-testid` on anything E2E touches** (buttons, rows keyed by id, inputs).
- **Density-first UI** (target user has 90+ characters): compact sortable tables with
  toggleable columns and filters, not cards. See the [UI conventions in
  CLAUDE.md](../CLAUDE.md#ui-conventions).
- **Status colors match in-game EVE colors**; idle is neutral (not a warning); absent
  values render a plain `—` (`<span className="muted">—</span>`), never an alarming chip.
- **Charts** go through the `useAmChart` wrapper and shared `--anim-*` motion tokens; keep
  motion subtle.

---

## 10. Testing conventions

- **Unit tests target pure modules only** — no Electron, no SQLite. That's why parsers,
  analysis, view logic, and formatting live in dependency-free files. 262 tests currently
  run in ~1s because nothing boots a runtime.
- **Test the logic, mock nothing.** If a test would need to mock the DB or ESI, the logic
  under test is in the wrong layer — extract it to a pure module first.
- **E2E (Playwright `_electron`)** drives the real packaged-ish app against a throwaway
  profile for flows that cross the whole stack.
- Name tests after the module (`rosterView.test.ts` ↔ `rosterView.ts`).

---

## 11. Security posture (keep these invariants)

- `BrowserWindow` uses `sandbox: true`, `contextIsolation: true`, `nodeIntegration:
  false`. Never relax these.
- `setWindowOpenHandler` denies in-app navigation and routes external URLs to the OS
  browser. New link behavior goes through `shell.openExternal`.
- OAuth is PKCE (public client_id, no secret); `state` is validated on the loopback
  callback; refresh tokens are encrypted at rest via `safeStorage`.
- One process per profile (single-instance lock) — required for token-family safety.

---

## 12. Quick checklist for a new change

- [ ] `npm run format` clean, no `any`, no suppressions.
- [ ] New IPC surface? Added to `shared/ipc.ts` + `preload/index.ts` + `register.ts`, and
      the handler is thin.
- [ ] SQL only inside a repository; new schema is a new appended migration.
- [ ] ESI only through `esiGet`; scope-gated calls guarded; optional pulls are best-effort.
- [ ] Non-trivial derivation extracted to a pure module with a unit test.
- [ ] Nullable/absent fields documented with what absent means; reused `EsiDataStatus`
      where the reason matters.
- [ ] Renderer imports `mco` from `lib/ipc`, uses `data-testid`, no `window.confirm`.
- [ ] `npm run typecheck && npm run lint && npm run test:unit` green.
