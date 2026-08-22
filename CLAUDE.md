# CLAUDE.md — MCO (Massive Character Organization)

MCO is a desktop tool for EVE Online players with a **high character count (10+, designed
around ~90+)**. It organizes characters outside the game: training/skill data, account
mapping, fit testing ("how many of my characters can fly this?"), skill plan tracking,
grouping, capability tags, location tracking, jump-clone/implant tracking, jump fatigue,
a blueprint (BPO) checklist, a mining ledger, and skill-queue notifications.

Deeper documentation lives in [`docs/`](docs/README.md):

| Doc | Covers |
| --- | --- |
| [docs/architecture.md](docs/architecture.md) | Process model, IPC, launch modes, directory layout |
| [docs/esi.md](docs/esi.md) | EVE SSO (PKCE), token storage, ESI client, caching, rate limiting, scopes |
| [docs/database.md](docs/database.md) | SQLite setup, migration system, full schema reference |
| [docs/sde.md](docs/sde.md) | Static Data Export download/import pipeline |
| [docs/features.md](docs/features.md) | Every page/feature + the skill-analysis engine |
| [docs/development.md](docs/development.md) | Commands, env vars, testing, CI, packaging |

## Stack

- **Electron** (main + preload + renderer) built with **electron-vite**; packaged with **electron-builder**.
- **TypeScript** everywhere, strict. React 19 + react-router in the renderer.
- **better-sqlite3** (synchronous SQLite, WAL) in the main process only.
- **vitest** for unit tests, **Playwright** (`_electron`) for E2E. CI runs on Linux/Windows/macOS.
- Data sources: EVE **ESI** API (authed via SSO PKCE) and the EVE **SDE** static data (YAML zip, imported into SQLite).

## Commands

```
npm run dev              # run the app with hot reload
npm run typecheck        # tsc for node (main/preload) + web (renderer)
npm run lint             # eslint
npm run test:unit        # vitest
npm run test:e2e         # electron-vite build + playwright (real app, throwaway profile)
npm run dist             # build + package installer (electron-builder)
```

## Architecture in one paragraph

The renderer is sandboxed (no Node) and talks to the main process only through
`window.mco`, a typed API (`McoApi` in `src/shared/ipc.ts`) exposed by the preload script.
Every channel is declared in `IpcChannel` and wired to a service or repository call in
`src/main/ipc/channels/<domain>.ts`, which `register.ts` composes (and then checks that no
declared channel was left unwired). Services (`src/main/services/`) compose ESI fetches, SDE
lookups and DB reads into view models; repositories (`src/main/db/repositories/`) are the
only code that touches SQL. Pure logic (parsers, analysis math, roster filtering/sorting)
is kept in dependency-free modules (`src/main/fits/`, `src/main/plans/`,
`src/main/notifications/`, `src/renderer/src/lib/`) so unit tests need no Electron or DB.

Key invariants:

- **Renderer never touches ESI, SQLite, or Node APIs.** Add a channel to
  `src/shared/ipc.ts` + preload + `ipc/channels/<domain>.ts` instead.
- **Pages load through `useMcoData`** (`src/renderer/src/lib/useMcoData.ts`) — never a
  hand-rolled `useState`/`useEffect`/try-catch copy. It owns the data/error/loading
  state, `errorMessage()`, the optional `mco.characters.onChanged` subscription, and
  discarding superseded requests.
- **All ESI calls go through `esiGet` in `src/main/esi/client.ts`** — it handles caching
  (ETag/Expires), token refresh, the error-limit rate limiter, and retries. Never `fetch`
  ESI directly. Paginated routes use its sibling `esiGetPaged`, which pages by ESI's
  `X-Pages` — never write a page loop that infers the end from a short page or a 404.
- **One process per profile** (single-instance lock): EVE SSO rotates refresh tokens on
  every refresh, so two processes racing a refresh would invalidate the token family.
- **Refresh tokens are encrypted at rest** with Electron `safeStorage`; the client_id is
  public (PKCE, no secret).
- **Sync is cache-driven, not clock-driven**: a character is "due" when its ESI skills
  cache entry has expired (ESI's own `Expires` header), swept hourly by the scheduler.
- **Schema changes are new migrations** appended to `src/main/db/migrations.ts` — never
  edit an existing migration.
- **The SDE build is discovered at run time, not pinned.** MCO reads CCP's
  `latest.jsonl` catalogue (`sde/latest.ts`, `services/sdeUpdateService.ts`) and imports
  whatever build it names, so a game patch that adds ships or skills is a re-import the
  user runs — not a release here. `SDE_PINNED_BUILD` is only the offline floor; don't
  turn it back into the source of truth.
- **MCO is not a corporation tool.** The one corporation scope it takes
  (`esi-corporations.read_blueprints.v1`) exists because BPO collections live in an
  **alt corp** — a corporation wholly controlled by one player, used as a shared
  hangar. It is *not* in `ESI_SCOPES`: one character opts into it per tracked corp and
  becomes that corp's reader (`startLogin(extraScopes)`). Resist letting other corp
  endpoints in behind it; each one is its own decision.

## Organization model

The tool organizes characters through three deliberately separate concepts:

- **Account → Character is mandatory.** A character cannot exist in EVE without an
  account; every character is tied to exactly one account (locally: an "account bucket"
  the user assigns, since ESI never reveals account membership). Account membership is the
  one relationship a character must have.
- **Group membership is optional.** A character can stand alone or belong to many groups.
  Groups are user-defined organizational units (e.g. "WH defense", a specific
  supercapital fleet).
- **Tags are capabilities, assigned at the character level, group-independent.** A tag
  records what a character *can do*: "Is able to Cyno", "Is able to Hyper HIC", "Is able
  to Fax", "Is able to Command Boost". A character has many tags. A character's
  role/function ("this is my Cyno alt") is expressed by its tags — it lives on the
  character, NOT on any group. Being in multiple groups never changes a character's
  capabilities; the tag travels with the character. Tags are assigned on the Tags page,
  by right-clicking a character wherever one is listed (Roster rows, fit/plan result
  buckets — `components/CharacterContextMenu.tsx`), or in bulk from a fit's "Can fly
  fully" / plan's "Plan complete" section header (`components/BulkTagBar.tsx`) — tag
  everyone who has a capability in one action, for initial setup.

Schema: `tags` + `character_tags` (character↔capability) and `character_groups` +
`character_group_members` (character↔group). See `src/main/db/migrations.ts` v9–v10.

## UI conventions

- **Density first.** The target user has ~90+ characters; tables must stay scannable at
  that scale. Prefer compact rows, sortable columns, and filters over cards or whitespace.
- **Status colors match EVE in-game colors** — e.g. jump fatigue is blue like the
  in-game fatigue timer (`.chip--fatigue`). Security status uses the high/low/null tiers
  (`securityTier` in `src/renderer/src/lib/format.ts`).
- **Idle is routine, not a warning.** With 90+ characters most are idle; the Idle chip is
  neutral. Absent/empty values render as a plain "—", never an alarming chip.
- Missing-data states use `EsiDataStatus` (`ok` / `pending` / `scope-missing` /
  `login-expired`) so the UI can say *why* data is absent instead of showing an error.

## External references

- ESI docs: https://github.com/esi/esi-docs
- ESI rate limiting: https://developers.eveonline.com/docs/services/esi/rate-limiting/
- ESI best practices: https://developers.eveonline.com/docs/services/esi/best-practices/
- SDE docs: https://developers.eveonline.com/docs/services/static-data/
- SDE build catalogue (`SDE_LATEST_URL` in `src/main/config.ts`, read on every check):
  https://developers.eveonline.com/static-data/tranquility/latest.jsonl
- SDE zip for one build (`sdeZipUrl`):
  https://developers.eveonline.com/static-data/tranquility/eve-online-static-data-<build>-yaml.zip
