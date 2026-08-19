# SDE — Static Data Export

The SDE is CCP's dump of EVE's static game data. MCO needs it to turn ids into names
(skills, ships, implants, systems) and to know **which skills each item requires** —
without it, fit testing and plan analysis cannot run.

- Docs: https://developers.eveonline.com/docs/services/static-data/
- Download: pinned build in `SDE_URL` (`src/main/config.ts`), currently
  `eve-online-static-data-3351823-yaml.zip`. Bump the constant (or set `MCO_SDE_URL`)
  to move to a newer release.

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

## Upgrading the SDE

1. Find the new build number on developers.eveonline.com.
2. Update `SDE_URL` in `src/main/config.ts` (or set `MCO_SDE_URL` to test first).
3. Run the import from the app — replace-based import means no migration is needed.
