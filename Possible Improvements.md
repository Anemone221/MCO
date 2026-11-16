# Possible Improvements

An analysis of MCO at 0.6.0 (working tree of 2026-11-11): the main process (auth, ESI
client, sync, services, repositories, SDE pipeline), the IPC boundary, the renderer, the
tests and the CI/packaging setup.

**Baseline.** The codebase is in good shape. Unit tests pass (61 files, 722 tests), the
layering described in `CLAUDE.md` is followed in the code, and the release blockers from
the two earlier reviews (`improvement-plan.md` and `release-review.md`) are done. What is left falls into three
groups: workflows that do not yet scale to 90+ characters, safety nets around data that
cannot be re-downloaded, and items the earlier reviews recorded but never scheduled.

**How to read the score.** The improvement score (1–10) is how much better the program
gets for its user if the item is done: 10 changes daily use or removes a real risk of
losing data, 5 is a solid quality gain, 1 is cosmetic. It is not an effort estimate;
effort is given separately as S (hours), M (a few days) or L (a week or more).

Items marked _carried over_ were raised in an earlier review and are still open. I
re-checked each against the current code. Items marked _new_ are not in any existing doc.

The earlier reviews this list replaces — `docs/improvement-plan.md`,
`docs/release-review.md` and `docs/optimization.md` — have been removed from the tree.
The section numbers cited below (for example "release-review §3.4") refer to those files
as of commit `f24325b`; read one with `git show f24325b:docs/release-review.md`.

## Summary

| #   | Improvement                                                     | Score | Effort | Origin                 |
| --- | --------------------------------------------------------------- | ----- | ------ | ---------------------- |
| 1   | Bulk onboarding and a re-authorization queue                    | 9     | M      | new                    |
| 2   | Database-backed tests for repositories, services and sync       | 9     | M      | carried over           |
| 3   | Multi-select and bulk actions on the Roster                     | 8     | M      | new                    |
| 4   | Automatic backups, including one before every migration         | 8     | S      | partly carried over    |
| 5   | Atomic SDE import with a download timeout                       | 7     | S      | carried over           |
| 6   | Renderer crash recovery (error boundary, `render-process-gone`) | 7     | S      | partly carried over    |
| 8   | Offline and sleep awareness for the sweep and live tracking     | 6     | S      | new                    |
| 9   | Batch the per-character read paths                              | 6     | M      | carried over, extended |
| 10  | Purge `esi_cache`, and clear it when a character is removed     | 6     | S      | carried over           |
| 11  | Turn on the lint rules that are installed but not enabled       | 6     | S      | new                    |
| 12  | Finer change events and ticking countdowns                      | 5     | M      | partly carried over    |
| 13  | Notification preferences and retention                          | 5     | S      | new                    |
| 14  | A log file that survives a restart                              | 5     | S      | new                    |
| 15  | Keep access tokens in memory, not in the database               | 5     | S      | carried over           |
| 16  | Quick search and keyboard access                                | 5     | M      | new                    |
| 17  | Export tables to CSV or the clipboard                           | 4     | S      | new                    |
| 18  | Read ESI's rate-limit headers before a 429 arrives              | 4     | S      | new                    |
| 19  | Route-level code splitting                                      | 4     | S      | carried over           |
| 20  | Split the four oversized files                                  | 4     | M      | partly carried over    |
| 21  | macOS updates and a published Linux build                       | 4     | M      | carried over           |
| 22  | Small fixes                                                     | 3     | S      | mixed                  |

---

## 1. Bulk onboarding and a re-authorization queue — score 9 — ✅ done

_New. Effort M._

Adding a character is one click, one browser round trip and one return to MCO
([Roster.tsx:281](src/renderer/src/pages/Roster.tsx#L281) →
`startLogin` in [esi-oauth.ts:204](src/main/auth/esi-oauth.ts#L204)), so a 93-character
roster is 93 repetitions of that. The same cost comes back every time a scope is added to
`ESI_SCOPES`, which has happened three times recently (mining ledger, character
structures, activities): every character is then missing a scope, and the only guidance
the UI gives is "re-add this character" on the Clones, Blueprints and Character pages. A
login that is abandoned in the browser also cannot be cancelled. The button reads
"Waiting for EVE SSO…" until the five-minute timeout, and the callback port is held for
that time.

The improvement is a continuous add mode (after each successful sign-in the next SSO page
opens until the user stops), a Cancel button for the pending login, and a
"Re-authorize" queue in Settings that lists every character with an expired login or a
missing scope and steps through them one after another. EVE SSO still needs one consent
per character, so this cannot become a single click, but it removes the switching between
windows and the hunting for which characters still need attention. This is the roughest
part of the app at the roster size it is built for, and it gets worse with every scope a
new feature adds.

## 2. Database-backed tests for repositories, services and sync — score 9 — ✅ done

_Carried over (improvement-plan C1, release-review §7.7). Effort M._

All 722 tests are pure unit tests. Nothing in the suite opens a SQLite database, so the
40 migrations, the 194 inline SQL statements in the repositories, every service that
builds a view model and the whole of `syncCharacter` are verified only by hand. The E2E
profile has no characters, so E2E proves the app boots and not that a sync works. The
sync task registry, the `ensureCharacter`/`upsertCharacter` split and the "a failed page
must not delete stored blueprints" rule were all written without a test that can run them.

better-sqlite3 runs in-process under vitest. A suite that runs every migration on a
temporary database, round-trips each repository, and drives `syncCharacter` against a
stubbed `esiGet` would cover the layer that holds user data and that changes with every
feature. It is also the precondition for items 5, 9 and 10 in this list, which rewrite
SQL paths and should not be done blind. One caveat: the native module must be built for
Node as well as for Electron, which needs a small change to the CI install step.

## 3. Multi-select and bulk actions on the Roster — score 8 — ✅ done

_New. Effort M._

The Roster acts on one character at a time. Assigning accounts is a per-row dropdown,
tags and groups are a per-row right-click menu, and Sync and Remove are per-row buttons.
Each single action sets `busy`, which disables every button in the table, and then
reloads five IPC calls, including a plan analysis of the whole roster
([Roster.tsx:175](src/renderer/src/pages/Roster.tsx#L175)). Bulk tagging exists only from
a fit's or plan's result header. Putting 93 characters into about 31 accounts is
therefore 93 dropdown changes with a full reload between each.

Row checkboxes with shift-click ranges and a bulk bar (assign account, add or remove tag,
add to group, sync selected) would turn the initial setup and every later reorganization
into a few actions. Since the existing filters already narrow the table, "filter, select
all visible, apply" covers most real cases. The main process needs batch variants of the
channels (`tags:addMembers` already exists as a model), so that one action is one
transaction and one reload.

## 4. Automatic backups, including one before every migration — score 8 — ✅ done

_Partly carried over (release-review §3.4); scheduled backups are new. Effort S._

The profile database holds data that cannot be fetched again: wallet journal and mining
ledger rows older than ESI's 30-day window, plus the whole organization model (accounts,
groups, tags, critical clones, plans, fits). The only backup is a manual export in
Settings ([settingsService.ts:161](src/main/services/settingsService.ts#L161)).
Migrations are delivered by the auto-updater and applied on the next start with no copy
taken first, and there have been 40 of them in 21 commits.

Taking a `db.backup()` snapshot to `mco-pre-v<N>.sqlite` whenever migrations are pending,
and keeping a small rotating set of automatic snapshots (for example the last five,
taken weekly), means a faulty migration or a corrupted file costs a restore, not the
history. It should come with a Restore action in Settings, because the current restore
procedure is "quit, replace the file by hand".

## 5. Atomic SDE import with a download timeout — score 7 — ✅ done

_Carried over (release-review §3.2 and §2.2.8). Effort S._

The importer writes each table in its own transaction as its file comes out of the zip
([importer.ts:66](src/main/sde/importer.ts#L66)). A failure halfway (corrupt zip, full
disk, the app closed during import) leaves groups from one build beside types and skill
requirements from another, and fit and plan analysis then run on mixed data with no
error. The download has no timeout and no length check
([downloader.ts:35](src/main/sde/downloader.ts#L35)), so a stalled connection hangs the
import with no way to cancel. This matters more than when it was first noted, because MCO
now discovers new SDE builds at run time and imports happen after every game patch.

Parsing everything first and applying all `replaceX` calls plus the version stamp in one
transaction makes an import all-or-nothing: the previous SDE stays fully usable until the
new one is completely in. Adding an abort timeout and comparing received bytes with
`Content-Length` turns a hung or truncated download into a clear, retryable error.

## 6. Renderer crash recovery — score 7

_Partly carried over (release-review §3.5); the error boundary is new. Effort S._

There is no React error boundary anywhere in the renderer, so an exception while
rendering any one page unmounts the whole app and leaves an empty window, including the
navigation. The main process has no `render-process-gone` or `unresponsive` handler
either, so a crashed renderer is also an empty window. In both cases nothing is written
to the log the user can export.

An error boundary around the routes keeps the sidebar alive and shows "this page failed,
reload it" with the error sent to the main-process log. A `render-process-gone` handler
that offers a reload does the same for a real renderer crash. Together they turn the
worst failure a user can see into a recoverable message, and give a bug report something
to contain.

## 8. Offline and sleep awareness for the sweep and live tracking — score 6 — ✅ done

_New. Effort S._

Nothing in the main process checks for connectivity or power state. With no network,
every request still goes through its full retry budget (three retries, 30-second timeout
each), for every character, every hour, and live tracking does the same every 20 seconds
and every 2 minutes. The result is a log full of failures and a Roster of "sync failed".
After the computer wakes from sleep, `setInterval` does not catch up, so data can be up
to an hour old with no sweep on the way, and the "next sweep" time in Settings is wrong.

Skipping ticks when `net.isOnline()` is false, pausing after a run of consecutive network
errors, and running a sweep on `powerMonitor`'s `resume` event make the background mode
behave properly on a laptop: quiet when offline, fresh shortly after waking. This matters
most for the tray mode, where MCO runs for days unattended.

## 9. Batch the per-character read paths — score 6 — ✅ done (prepared-statement hoisting not done)

_Carried over (optimization.md §1–2), extended with live tracking. Effort M._

Several builders still query once per character. `buildRoster` reads the queue and the
SP total per character ([characterSync.ts:567](src/main/services/characterSync.ts#L567)).
The Dashboard reads SP per character and decodes a stored JWT per character to check one
scope. New since the earlier review: live tracking's `observeCharacter` reads the entire
implants table, the entire locations table and the entire critical-set table once for
each online character every 20 seconds
([liveTracking.ts:123](src/main/services/liveTracking.ts#L123)), and `hasScope` decodes a
JWT on every call. No statement is prepared once and reused.

Each read is fast, so this is not a visible problem today. It is the part that scales
with roster size multiplied by event frequency, and live tracking raised the frequency
from hourly to every 20 seconds. Grouped queries (`GROUP BY character_id`), reading the
shared tables once per tick, and caching granted scopes per character bring the work back
to a fixed number of queries per reload. Do it together with item 2 so the rewritten
queries are tested.

## 10. Purge `esi_cache`, and clear it when a character is removed — score 6

_Carried over (release-review §3.1). Effort S._

`esi_cache` has no delete path at all
([esiCache.ts](src/main/db/repositories/esiCache.ts)). Every URL ever fetched keeps its
last response body. Removing a character deletes its row and its token, but the cached
ESI responses for that character (wallet balance, location, clones, implants, journal
pages) stay in the database, and they also go into every backup file.

The second part is the reason this scores above a housekeeping item: the removal dialog
says "Remove … and its stored login", and a user would reasonably expect the character's
data to be gone. Deleting the character's cache rows on removal, and purging entries that
expired more than 30 days ago on startup, fixes both the privacy gap and the slow growth
of the file.

## 11. Turn on the lint rules that are installed but not enabled — score 6

_New. Effort S._

[eslint.config.mjs](eslint.config.mjs) registers `eslint-plugin-react-hooks` as a plugin
but applies none of its rules, so `rules-of-hooks` and `exhaustive-deps` are not checked.
`useMcoData` was deliberately written around the missing `exhaustive-deps`. The
TypeScript rules are the non-type-aware set, so `no-floating-promises` and
`no-misused-promises` are off. The code handles promises carefully by convention (`void`
is used consistently), but nothing enforces it. There is also no coverage report and no
automated dependency updates, although Electron needs regular security updates.

Enabling the hooks rules and the two promise rules makes existing conventions something
CI checks. For an app whose background work is all promises, an unawaited promise is the
most likely source of a silent failure. Adding Dependabot or Renovate for Electron and
the build chain is a few lines of configuration. Expect a first pass of findings to fix
or annotate when the rules go on.

## 12. Finer change events and ticking countdowns — score 5

_Partly carried over (optimization.md §4); the countdown part is new. Effort M._

`characters:changed` is a single signal with no payload. Ten pages subscribe to it, and
each reloads everything on every event. The Roster's reload is five IPC calls including
plan analysis for every roster-flagged plan. Live tracking now sends this event whenever
one online character changes system. Separately, no timer runs in the renderer: "Time
left", queue end, fatigue and clone-jump cells are computed at render time and stay as
they were until the next reload, so a countdown can be many minutes out of date.

Adding a payload to the event (which characters, which domain) lets a page skip reloads
that do not concern it, and a short debounce merges bursts. A shared one-minute tick hook
keeps every countdown correct without any IPC. The result is a table that stays still
while someone is working in it and timers that can be trusted at a glance.

## 13. Notification preferences and retention — score 5 — ✅ done (quiet hours not built)

_New. Effort S._

There are five notification kinds (queue drain, idle Omega account, fatigue cleared,
clone jump ready, undocked in a critical clone) and no setting for any of them. With 93
characters, "fatigue cleared" and "clone jump ready" can produce many toasts in a day and
cannot be turned off without also losing the important ones. Dismissed notifications are
also never deleted from the table.

Per-kind switches in Settings, optionally with quiet hours, let the user keep the
critical-clone warning loud and silence the routine ones. That is the same principle the
UI already applies to the Idle chip. A retention rule (delete dismissed notifications
after 30 days) keeps the table bounded.

## 14. A log file that survives a restart — score 5 — ✅ done

_New. Effort S._

The log is an in-memory buffer of the last 5,000 lines of the current session
([log.ts](src/main/log.ts)). A crash writes a report, but anything short of a crash is
lost on restart: a sweep that failed overnight in tray mode, or characters that went
"login expired" yesterday. In a long tray session with live tracking, 5,000 lines can
also roll over within the session.

Appending the same lines to a size-capped rotating file in the profile folder (for
example two files of 2 MB) and including the previous file in "Export logs" makes it
possible to diagnose problems after the fact. For an app designed to run unattended,
that is when most problems are noticed.

## 15. Keep access tokens in memory, not in the database — score 5

_Carried over (release-review §2.2.5). Effort S._

Refresh tokens are encrypted with `safeStorage`, but the access token is stored as plain
text in `tokens.access_token`
([tokens.ts:78](src/main/db/repositories/tokens.ts#L78)). A copied `mco.sqlite`, or an
exported backup, therefore contains tokens for every character that stay valid for up to
20 minutes. Backups are the file users are most likely to move around or share when
asking for help.

Holding the access-token cache in a main-process `Map` closes that gap at the cost of
one refresh per character after a restart. `grantedScopes` currently decodes the stored
JWT, so the granted scope list needs to be written to the existing `scopes` column at
refresh time. That also removes the per-call JWT decode noted in item 9.

## 16. Quick search and keyboard access — score 5 — ✅ done

_New. Effort M._

There are 13 navigation entries and 93 characters, and no way to go straight to one
character except through the Roster and its search box. Sortable column headers are
click-only `<th>` elements that cannot be focused, so sorting is not available from the
keyboard, and the app defines almost no keyboard shortcuts.

A Ctrl+K palette that searches characters, fits, plans, groups and pages gives one-step
navigation from anywhere, which fits the density-first goal. Making the headers real
buttons and adding a few shortcuts (focus search, sync) is the smaller accessibility
half.

## 17. Export tables to CSV or the clipboard — score 4

_New. Effort S._

The only export in the app is a skill plan to the clipboard. Roster, Wallet, Mining,
Blueprints and the fit and plan result lists cannot be taken out of MCO, although players
at this scale commonly keep spreadsheets and share lists with corpmates (who can fly a
doctrine, what was mined last month).

A "Copy as CSV" button on each table, working on the rows as currently filtered and
sorted, is small because the view logic already lives in pure modules such as
`rosterView` and `miningView`. `system:copyText` already exists for the clipboard.

## 18. Read ESI's rate-limit headers before a 429 arrives — score 4 — ✅ done

_New. Effort S._

The rate limiter watches the legacy error-limit headers proactively, but handles the
newer per-route rate limit only after the fact, by backing off when a 429 arrives
([rate-limiter.ts:96](src/main/esi/rate-limiter.ts#L96),
[client.ts:206](src/main/esi/client.ts#L206)). Each 429 pauses every request in the app
for the `Retry-After` period, which defaults to 60 seconds. Live tracking has added a
steady request stream that makes hitting a bucket more likely.

Reading the remaining-budget headers ESI sends with its rate-limited routes, and slowing
down only the affected route group as it runs low, avoids the app-wide pause. Check the
header names and bucket rules against the rate-limiting page linked in `CLAUDE.md`
before building this, because I did not verify them against the live API. A smaller
related fix: a request that is retrying sleeps while still holding its concurrency slot,
and it could release the slot first.

## 19. Route-level code splitting — score 4

_Carried over (optimization.md §3a). Effort S._

[App.tsx](src/renderer/src/App.tsx) imports all 19 pages eagerly, so amCharts, the
largest dependency, is parsed at startup even when the user never opens a chart page.
`React.lazy` on the chart pages (Dashboard, Wallet, Mining, Character detail) with a
`Suspense` fallback reduces startup work.

The gain is modest because everything loads from local disk. It is worth doing mainly if
the Dashboard stops being the landing page, or if startup time is ever measured as a
problem.

## 20. Split the four oversized files — score 4

_Partly carried over (release-review §5.5). Effort M._

[PlanCreator.tsx](src/renderer/src/pages/PlanCreator.tsx) is 1,547 lines, about 2.5 times
the next-largest page. [styles.css](src/renderer/src/styles.css) is 2,972 lines in one
file. [shared/types.ts](src/shared/types.ts) has grown from 816 lines at the last review
to 1,394. [planDraft.ts](src/renderer/src/lib/planDraft.ts) is 901. Three of these four
are being changed in the current working tree, which is typical: they are the files every
feature touches.

Splitting PlanCreator into components in the way GroupDetail was split, types by domain
behind an index file, and the stylesheet per page or component changes no behaviour. It
makes each later feature a smaller and more local diff. The leftover `useMcoAction` hook
(five copies of the same mutation runner in Accounts, Tags, Groups, Roster and
GroupDetail) belongs to the same cleanup.

## 21. macOS updates and a published Linux build — score 4

_Carried over (improvement-plan A3, release-review §7.6). Effort M, plus an Apple
developer account._

In-app updates work only on Windows. The macOS build is ad-hoc signed, so
`electron-updater` will not update it, and first launch needs an `xattr` command. Linux
has an AppImage target configured, but it is neither built in CI nor published. Whether
this matters depends on who uses MCO: for a Windows-only audience it scores lower.

Either state plainly in the README that Windows is the supported platform, or pay for
notarization so macOS users get the same update path. A half-supported platform costs
more support effort than either option.

## 22. Small fixes — score 3

_Mixed. Effort S each._

- **One helper for the skills URL** — ✅ done (`skillsCacheUrl` in `esi/endpoints.ts`). The "is this
  character due" check builds `/characters/<id>/skills` by hand in
  [characterSync.ts:490](src/main/services/characterSync.ts#L490) and
  [settingsService.ts:28](src/main/services/settingsService.ts#L28), and both must match
  [endpoints.ts:50](src/main/esi/endpoints.ts#L50) exactly. If they drift, every
  character is "due" every hour with no error. Export one helper from `endpoints.ts`.
- **Cap input lengths** (carried over, release-review §2.2.7). Tag, group and account
  names and pasted fit or plan text are stored with no length limit.
- **Clamp the "next sweep" estimate** — ✅ done with item 8 (the cadence restarts on wake). After sleep it
  can show a time in the past. Item 8 fixes the cause.
- **First-run guide** (carried over, improvement-plan D). The SDE and client-id banners
  work, but a single "import static data, then add your first character" screen would be
  clearer for a new user.
- **Progress for "Sync all"** — ✅ done (the activity indicator at the bottom of the window). The button reads "Syncing…" for the minutes a full fleet
  takes. The sweep already works in waves and could report "34 / 93".

---

## Suggested order

1. **Items 2 and 4 first.** Tests and automatic backups are the safety net for everything
   else, and item 4 is small.
2. **Items 1 and 3 next.** These change daily use at 90+ characters the most. Item 1
   should land before any feature that adds a scope.
3. **Items 5, 6, 8, 10 and 11.** Each is a short, contained fix for a failure that is
   currently silent.
4. **The rest** as the code they touch comes up for other reasons.
