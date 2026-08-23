# SDE — Static Data Export

The SDE is CCP's dump of EVE's static game data. MCO needs it to turn ids into names
(skills, ships, implants, systems) and to know **which skills each item requires** —
without it, fit testing and plan analysis cannot run.

- Docs: https://developers.eveonline.com/docs/services/static-data/
- Download: the build is **discovered at run time**, not compiled in. MCO reads CCP's
  catalogue (`SDE_LATEST_URL` → `latest.jsonl`) and imports whatever build it names; see
  "Staying current" below. `SDE_PINNED_BUILD` in `src/main/config.ts` is only the floor
  used when the catalogue can't be read, and `MCO_SDE_URL` overrides both with an exact
  zip URL.

The SDE is **not bundled** with the app. On first run the renderer shows an import
banner (`SdeBanner`); the user clicks import, and the zip (~100+ MB) is downloaded once
and parsed into SQLite. Features degrade gracefully until then (see
"Gating" below).

## Pipeline

```
sde:import (IPC)
  └─ runSdeImport (services/sdeService.ts)      progress → sde:progress events
       ├─ downloadSde (sde/downloader.ts)       → userData/sde-cache/sde.zip
       └─ importSde   (sde/importer.ts)         streams entries out of the zip (yauzl)
            ├─ _sde.yaml            → build number → sde_version
            ├─ categories.yaml      → sde_categories
            ├─ groups.yaml          → sde_groups
            ├─ types.yaml           → sde_types        (streamed, progress-counted)
            ├─ typeDogma.yaml       → sde_type_skill_reqs + sde_skill_ranks
            │                         + sde_skill_attributes (streamed)
            ├─ blueprints.yaml      → sde_blueprints
            ├─ mapRegions.yaml      → sde_regions
            ├─ mapSolarSystems.yaml → sde_systems (name, region, security, position)
            └─ mapStargates.yaml    → sde_system_jumps
```

Notes:

- The zip is processed entry-by-entry with `yauzl` (lazy entries); the two huge files
  (`types.yaml`, `typeDogma.yaml`) are parsed via streaming parsers in `sde/parse.ts`
  that emit progress counts, so the UI can show "N types processed" instead of freezing.
- `types.yaml` also supplies each type's **volume** (m³ per unit), which is what
  turns the mining ledger's unit counts into the volume miners measure in — a
  unit of Veldspar is 0.1 m³ and a unit of ice 1,000, so summing units would
  produce a number that means nothing. Nullable: a profile imported before the
  column existed reads as "no volume for this type", and the Mining page says so
  instead of reporting 0 m³.
- `typeDogma.yaml` supplies three things per type: its **required skills + levels**
  (dogma attributes), and, for skills themselves, the **rank** (skillTimeConstant) used
  by the SP formula plus the **primary/secondary training attributes** (dogma 180/181,
  whose values are attribute ids: 164 cha, 165 int, 166 mem, 167 per, 168 wil) used by
  the training-time cost metric.
- `blueprints.yaml` (4 MB) supplies **what each blueprint makes**. Only the
  `manufacturing` product is taken (or `reaction`, for reaction formulas):
  `invention` carries a `products` list too, but that is the *Tech II blueprint* the
  process yields, and reading it would file every Tech I blueprint under its Tech II
  descendant. Parsed by the same kind of line scan as types.yaml (`parseBlueprints`).
- `mapSolarSystems.yaml` also carries each system's **position** (metres, `pos_x/y/z`)
  and `mapStargates.yaml` (2.8 MB, ~14k gates) the **links between systems**. Together
  they are the map as a graph: gate jumps by breadth-first search, light years by
  straight-line distance (`main/map/routing.ts`). Positions are nullable — a profile
  imported before they existed reads as "unknown", not as the centre of New Eden.
- Each table is fully replaced inside a transaction (`replace*` in
  `db/repositories/sde.ts`) — re-importing is idempotent and how you upgrade.
- Progress stages surfaced to the renderer (`SdeProgress` in `shared/types.ts`):
  `downloading` (with byte counts) → `categories` → `groups` → `types` → `dogma` →
  `blueprints` → `maps` → `finalizing` → `done` | `error`.

## Status & gating (`getSdeStatus`)

`SdeStatus` reports `installed`, `version`, `importedAt`, plus five capability flags
derived from actual table contents (not the version stamp):

| Flag | True when | Gates |
| --- | --- | --- |
| `hasSkillData` | `sde_type_skill_reqs` is non-empty | Fit/plan **analysis**. Without it, analyses return `needsSkillData: true` and the UI explains instead of showing wrong numbers. |
| `hasMapData` | `sde_systems` is non-empty | System/region/security name resolution on Roster & Location (falls back to "—"). |
| `hasSkillAttributes` | `sde_skill_attributes` is non-empty | The **Time** cost metric on fit/plan analysis. Without it, analyses return `needsSkillAttributes: true`, per-character `timeGapMinutes` is null, and the Time view explains why. |
| `hasBlueprintData` | `sde_blueprints` is non-empty | The **blueprint checklist**. Without it the Blueprints page says so instead of claiming 0 of 0 owned. |
| `hasJumpData` | `sde_system_jumps` is non-empty | **Gate distances** in the Location page's nearest-to-a-system ranking. Without it every distance is "no route", so the ranking says to re-import instead. |

Name resolution helpers used everywhere: `getTypeNames(ids)`, `getSystems(ids)`,
`resolveTypeIdsByName(names)` (case-insensitive — how pasted EFT/plan text finds type
ids), `getCategoryForTypes(ids)` (e.g. drone vs. cargo classification in fit analysis).

## Staying current

EVE patches in ships, skills and blueprints between MCO releases, and CCP publishes a new
SDE build for each. Because every table is replaced on import, following the game is a
re-import — so the build number must not be something only a new MCO can change.

```
latest.jsonl  {"_key": "sde", "buildNumber": 3473160, "releaseDate": "…"}
  └─ checkSdeUpdate  (services/sdeUpdateService.ts)   → SdeUpdateStatus
       ├─ cached in app_settings (`sde.lastCheck`), refreshed at most daily
       ├─ compared against sde_version by `isNewerBuild` (sde/latest.ts)
       └─ raises the SdeBanner: "build N is available — re-import"
```

- **Parsing is defensive.** The catalogue is JSON *lines* and may list datasets that are
  not the SDE, so the entry is picked by `_key`, not by position; an unreadable line is
  skipped, and a body naming no build is a *failed check*, never an answer. `latest.jsonl`
  reporting nothing would otherwise read as "you are up to date".
- **The check never throws.** A failure keeps the last known answer on screen with a
  sentence saying why it didn't move — the same contract as `updateService.ts`, whose
  shape this deliberately mirrors (daily cache, per-build dismissal, `force` to ask now).
- **Nothing downloads on its own.** A check only raises the banner; the ~100 MB zip moves
  when the user clicks. Dismissing hides one build, so the next one prompts again.
- **The import resolves the build fresh** (`resolveSdeDownload`), not off the daily cache:
  someone clicking import is asking for current data, and 80 bytes of catalogue against a
  100 MB download is free. A check that fails there falls back to `SDE_PINNED_BUILD` —
  old data resolves almost every id, no data resolves none.
- Surfaced in two places: the banner on every page (`SdeBanner`), and Settings → sync
  status → **Check for new static data**, which ignores the daily interval.

Checks run everywhere by default, unlike the app-update check: static data goes stale with
*the game*, not with the build, so a dev run needs the answer too. `MCO_SDE_CHECK=0` opts
out (what the E2E suites set to stay off the network).

Only a **format** change — CCP moving a file or renaming a field — now needs a new MCO.

### Importing a specific build

1. Set `MCO_SDE_URL` to that build's zip URL (`sdeZipUrl` in `src/main/config.ts` spells
   the pattern). While it is set the update check stands down rather than offer a build
   the import won't fetch.
2. Run the import from the app — replace-based import means no migration is needed.
