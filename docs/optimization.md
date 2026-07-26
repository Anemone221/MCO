# MCO Optimization Path

Performance-focused follow-up to the [improvement plan](improvement-plan.md). **Nothing
here is a current bug** — the app is correct and, at today's data sizes, fast. These are
the places that will bend first as the roster grows toward (and past) the 90+ characters
MCO is designed for, and as `charactersChanged` fires a full reload after every sweep.

Measure before and after each item — better-sqlite3 is synchronous and microsecond-fast
per statement, so some of these are "correctness of shape" more than measurable wins today.
Ordered by leverage.

---

## 1. Kill the N+1 read patterns (highest leverage)

Several view-model builders loop over the roster issuing per-character queries. At 90+
characters, and given `buildRoster` re-runs on every background sweep's
`charactersChanged` event, these dominate.

### 1a · `buildRoster` (`services/characterSync.ts`)
Batched well up front (accounts, locations, fatigue, wallets, cloneMeta, systems, ship
names) — but then, per character:
- `getTotalSp(id)` — one aggregate query each,
- `getTrainingStatus(id)` → `getQueue(id)` (one query) **and** `getTypeNames([oneId])` (one
  query) each.

≈ **3 × N queries** (~270 for 90 chars) per roster build. Replace with set-based reads:

- **Total SP for everyone in one query:**
  ```sql
  SELECT character_id, COALESCE(SUM(sp), 0) AS total
  FROM character_skills GROUP BY character_id
  ```
  → `Map<number, number>`.
- **Queue heads for everyone in one query:** select the whole `skill_queue` ordered by
  `(character_id, position)`, group in JS, keep each character's `position = 0` head (or a
  `WHERE position = 0` variant). That yields both training status and (for the group page)
  queue length/end date without per-character round-trips.
- **Skill-type names batched once:** collect every training skill's `skillTypeId` across the
  roster and call `getTypeNames(allIds)` a single time (the codebase already uses this
  batch pattern for systems/ships — extend it to training names).

### 1b · `buildDashboardSummary` (`services/dashboardService.ts`)
Same per-character `getTotalSp(id)` in the `.map`. Reuse the single grouped-SP query from
1a. This builder runs on every Dashboard visit.

### 1c · `buildGroupDetail` (`services/groupService.ts`)
Calls `buildRoster()` (inherits all of 1a), then per member `getQueue(id)` **and**
`listTagsForCharacter(id)`. After fixing 1a, also batch tags: one
`SELECT character_id, tag_id, … FROM character_tags JOIN tags …` grouped in JS, instead of
one query per member.

**Shared refactor:** introduce batch repository functions — `getTotalSpByCharacter():
Map`, `getQueueHeadsByCharacter(): Map`, `listTagsByCharacter(ids): Map` — and have
`buildRoster`/`buildGroupDetail`/`buildDashboardSummary` consume them. This is the single
change that most improves scaling, and [C1 DB-backed tests](improvement-plan.md#c1--no-db-backed-tests-p2)
should land alongside it to lock the behavior.

---

## 2. Hoist prepared statements

Repositories call `getDb().prepare('SELECT …')` **inline on every invocation**, so SQLite
re-parses the SQL each call. The recommended better-sqlite3 idiom is to prepare once and
reuse. Because `getDb()` opens lazily, use a small memoization helper rather than
top-of-module `const stmt = db.prepare(…)`:

```ts
const cache = new WeakMap<Database, Map<string, Statement>>();
function stmt(sql: string): Statement {
  const db = getDb();
  let m = cache.get(db);
  if (!m) cache.set(db, (m = new Map()));
  let s = m.get(sql);
  if (!s) m.set(sql, (s = db.prepare(sql)));
  return s;
}
```

Then `stmt('SELECT …').all(id)`. Micro-optimization individually, but it touches every hot
read path and compounds with the N+1 fixes. Low risk, mechanical.

---

## 3. Renderer bundle & startup

### 3a · Route-level code splitting
`App.tsx` eagerly imports all 15 pages, so the initial renderer bundle includes
amCharts5-heavy pages (Dashboard, Wallet, Character radar) even when the user lands on
Roster. Convert routes to `React.lazy` + a `<Suspense>` fallback:

```ts
const Dashboard = lazy(() => import('./pages/Dashboard'));
```

amCharts is the largest single dependency; deferring the chart pages should measurably
shrink first-paint work. (The dependency split is already correct — amCharts/react are
`devDependencies` because Vite bundles them into the renderer; only the main-process
runtime deps `better-sqlite3`/`yaml`/`yauzl` are `dependencies`. Keep it that way.)

### 3b · Confirm chart cleanup
`useAmChart` should dispose its root on unmount (verify no root leaks across route
switches). With lazy routes this matters more. Add a quick check that repeated navigation
between Dashboard and Roster doesn't grow retained amCharts roots.

---

## 4. Sweep-driven reload cost

Every background sweep fires `charactersChanged`; each open page reloads its full view
model (Roster does 4 IPC round-trips + a full `buildRoster`). Today that's fine. If it
becomes noticeable at scale:

- **Debounce** the renderer's reload so a burst of sweep waves coalesces into one reload.
- Consider a **coarse "dirty" signal** (which character ids changed) so the page can update
  incrementally instead of rebuilding — only worth it if profiling shows the full rebuild
  hurts. Don't pre-build this; the batch-query fixes in §1 likely make it moot.

---

## 5. SDE import (one-time, but heavy)

The SDE import parses large YAML and bulk-inserts. It's a first-run/occasional operation,
so it's low priority, but if import time is a pain point:

- Ensure inserts are wrapped in a single transaction per table (delete-then-insert set
  pattern) rather than autocommit per row — check `sde/importer.ts` follows the
  `replaceSkills` transaction idiom.
- The YAML is streamed from a zip (`yauzl`); confirm parsing is streaming/entry-by-entry
  rather than buffering the whole archive if memory spikes on import.

(Flagged for completeness — verify against `sde/importer.ts` before investing; it may
already do all of this.)

---

## 6. Database-level tuning (only if measured)

Current pragmas are already sensible (`WAL`, `synchronous = NORMAL`, `foreign_keys = ON`).
Schema is well-indexed for its joins. Before adding indexes, capture a real query plan
(`EXPLAIN QUERY PLAN`) for the group/roster reads **after** §1 — the batch queries may need
one covering index (e.g. on `character_skills(character_id, sp)`), but add it in response
to a plan, not speculatively.

---

## Priority summary

| # | Item | Effort | Payoff | When |
| --- | --- | --- | --- | --- |
| 1 | Batch the N+1 roster/group/dashboard reads | M | High (scales with roster) | With DB tests |
| 2 | Hoist/memoize prepared statements | S | Low–Med, broad | Alongside §1 |
| 3a | Lazy-load chart-heavy routes | S | Med (first paint) | Anytime |
| 3b | Verify amCharts root disposal | S | Correctness/leak | With 3a |
| 4 | Debounce sweep-driven reload | S | Low today | Only if profiled |
| 5 | SDE import transaction/streaming audit | S | One-time | If import is slow |
| 6 | Index tuning from real query plans | S | Situational | After §1, measured |

Do **§1 + §2 together** (with [DB-backed tests](improvement-plan.md#c1--no-db-backed-tests-p2)),
ship **§3a** independently, and treat §4–§6 as measure-first. None of this blocks a
release; it's headroom for the roster sizes MCO is explicitly built for.
