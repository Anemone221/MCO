# MCO Documentation

Developer documentation for MCO (Massive Character Organization), a desktop tool for
EVE Online players managing a large character roster. Start with
[architecture.md](architecture.md) if you're new to the codebase.

| Doc | Covers |
| --- | --- |
| [architecture.md](architecture.md) | Electron process model, IPC pattern, launch modes (window vs. background tray), directory layout, data flow |
| [esi.md](esi.md) | EVE SSO login (OAuth2 PKCE), token storage & refresh, the ESI HTTP client, caching, rate limiting, scope handling |
| [database.md](database.md) | SQLite configuration, the migration system, full table-by-table schema reference |
| [sde.md](sde.md) | EVE Static Data Export: what it is, how the download/import pipeline works, which tables it fills |
| [features.md](features.md) | Every page and feature, plus the skill-requirement analysis engine shared by fits and plans |
| [development.md](development.md) | Setup, npm scripts, environment variables, testing strategy, CI, packaging & the background-sync installer shortcut |
| [code-style.md](code-style.md) | The conventions the codebase already follows: formatting, naming, the ESI/SQL⇄app boundary, layering, comments, testing, security posture |
| [improvement-plan.md](improvement-plan.md) | Prioritized path to shippable `.exe`s (icon, signing, CI packaging) plus hardening and test-gap follow-ups |
| [optimization.md](optimization.md) | Performance headroom for large rosters: N+1 read batching, prepared-statement hoisting, renderer code-splitting |

The repo root's [CLAUDE.md](../CLAUDE.md) is the condensed operating manual (stack,
invariants, organization model, UI conventions); these docs carry the detail.

## Glossary (EVE terms used throughout)

| Term | Meaning |
| --- | --- |
| **Character / toon** | A playable character. One EVE account holds up to 3; only one per account can train at a time (barring MCT). |
| **SP** | Skill points. Skills train in real time; each skill has 5 levels and a *rank* (training time multiplier). |
| **Skill queue** | The ordered list of skills a character is training. An empty queue means wasted training time — MCO warns before that happens. |
| **ESI** | EVE Swagger Interface — CCP's public HTTP API for live character data. |
| **SSO** | EVE's OAuth2 login service (login.eveonline.com) used to authorize ESI scopes. |
| **SDE** | Static Data Export — CCP's dump of static game data (item types, skills and their prerequisites, solar systems…). |
| **EFT format** | The plain-text ship fitting format (`[Hull, Fit name]` + one module per line) used by pyfa/EFT and the in-game client. |
| **Jump clone** | A parked alternate body (often holding an implant set) a character can jump into. |
| **Jump fatigue** | A cooldown accumulated by capital/jump travel; MCO shows it in blue to match the in-game timer. |
| **Cyno** | Cynosural field — a beacon a character lights so capital ships can jump to it. A classic alt capability. |
