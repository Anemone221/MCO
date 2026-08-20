# MCO — Massive Character Organization

A desktop tool for EVE Online players who run a **lot** of characters. It's built for
10+, designed around 90+, and it keeps the whole roster organized *outside* the game:
who's training what, which account is idle, who can fly a given fit, where everyone is
parked, which clones hold which implants, and which blueprints you actually own.

MCO is a local, single-user app. Everything lives in one SQLite file on your machine —
there is no server, no account, and nothing is uploaded anywhere.

- **Windows / macOS / Linux** — Electron; Windows is the primary target.
- **Free, open source (MIT)**, unofficial and not affiliated with CCP.
- **Version 0.3.0** — usable day to day, still pre-release. A Windows installer and a
  macOS DMG are on [Releases](https://github.com/Anemone221/MCO/releases); see
  [Install](#install) for the first-launch step each one needs, or build it from source
  (below).

---

## The problem it solves

Past a dozen characters, EVE's own UI stops helping. The client shows you one character
at a time, the launcher shows accounts but not what's inside them, and questions that
should take five seconds start taking twenty minutes of alt-tabbing:

| The question | Where MCO answers it |
| --- | --- |
| Which of my accounts are wasting training time right now? | Roster / Accounts |
| How many of my characters can fly *this* fit — and what's missing for the rest? | Fits |
| Who can light a cyno / fly a FAX / run boosts? | Tags |
| Where is everyone parked, and who's in a bad system? | Location |
| Which of my cyno alts is closest to *that* system? | Location |
| Which clone has the +5s, and who's off jump cooldown? | Clones |
| Do I already own that BPO, and who's holding it? | Blueprints |
| Whose skill queue runs dry this weekend? | Notifications |

The design bias throughout is **density**: compact sortable tables and filters, not
cards and whitespace. A page has to stay scannable with 90 rows on it.

---

## Feature tour

Pages, in sidebar order. Full detail lives in [docs/features.md](docs/features.md).

### Dashboard
Army-wide stats at a glance: EVE server status and player count, characters online,
characters registered, total SP, and income this month (bounties + ESS + mission
rewards + CONCORD reward payouts). Below the tiles, a packed-circle chart of every character sized by total SP,
each circle filled with that character's portrait — click one to open its sheet.

### Roster
The main table. Every character with account, capability tags, location, ship, currently
training skill, time left, queue left, jump fatigue, clone-jump readiness, total SP,
wallet balance and last sync. Free-text search plus account / training / tag filters,
sorting on every column, and a column picker that remembers what you hid. Right-click any
character to assign tags or group memberships in place.

Two time columns, deliberately: **Time left** is the skill currently training,
**Queue left** is when the whole queue runs dry. A queue with no dates means training is
paused, and says so.

### Character sheet
One character in full: total SP, the pending skill queue with real skill names, wallet,
jump fatigue, neural attributes and remap availability, jump clones, groups, tags, and
progress against every skill plan you've imported. Three traffic-light status squares
(Fatigue / Jump Clone / Training) answer "can this character act right now" — the Training
square goes red when an Omega account is training nobody. Location, current ship and
active implants are fetched live, each independently, so one ESI hiccup never blanks the
page.

### Accounts
Account buckets and character→account assignment. ESI never reveals which account a
character belongs to, so this mapping is yours to maintain — and it's what turns
"character X is idle" into "**this account** is burning training time". Each account
carries an Omega checkbox (also invisible to ESI) that drives the idle warning.

### Groups
User-defined organizational units — "WH defense", a specific supercapital fleet. A
character can be in none or many. Each group gets a status board with one dense card per
member, and three things you can pin to it:

- a **priority fit** and/or **priority skill plan** — the objective every member should be
  working toward, with a per-member progress bar;
- a **home station**, so any member whose medical clone sits somewhere else lights up red;
- a **pod whitelist** of solar systems, listing every implanted pod (active body or jump
  clone) parked outside them, with per-pod Ignore for the ones you meant to leave there.

### Tags
Capability tags — "Is able to Cyno", "Is able to Hyper HIC", "Is able to Fax". Tags live
on the *character*, never on a group, because a capability travels with the character no
matter which group it's in. Assign them from this page, by right-clicking a character
anywhere it's listed, or in bulk from a fit's "Can fly fully" section.

### Location
Where everyone is: system (color-coded high/low/null), region, docked status, ship, and
how stale the data is. Docked characters show *where* — NPC stations resolve from public
ESI, and player-owned citadels resolve through the structure importer, since Upwell
structure names are only visible to characters on the structure's ACL.

Name a system and the page becomes a ranking instead: every character ordered by how
far it is from there, in **gate jumps** (how fast it can fly there) or in **light
years** (whether a capital could jump to where it already sits). Filter by tag first
and it answers the real question — *which of my cyno alts is closest to this system* —
with the runners-up underneath, because the nearest one is no use if it shares an
account with the ship that needs the cyno.

Tick **Jump clones** and the ranking counts each character's jump clones too: a clone
two jumps out beats flying thirty. Each row shows which clone it would go through and
how long is left on that character's clone-jump cooldown — a clone jump arrives in a
pod, so it only helps where a cyno ship is already stationed.

### Fits — *"how many of my characters can fly this?"*
Paste an EFT fit (`[Hull, Fit name]` plus module lines; charges, `xN` quantities and
`/OFFLINE` all handled). MCO resolves every item through the SDE, collects the skill
requirements of the hull, modules, charges and drones, expands the full prerequisite
tree, and sorts your whole roster into buckets:

- **can fly it now**,
- **almost there**,
- **not close** — each with the exact missing skills, have/need levels and SP deltas.

The gap can be measured three ways, and you pick per fit: **SP**, **Large Skill
Injectors** (simulated through EVE's diminishing-returns tiers), or **training time**
(priced at each skill's own primary/secondary attributes, using that character's synced
neural attributes). Then right-click the results to tag people, or bulk-tag the entire
"Can fly fully" bucket in one action — the fastest way to set up capability tags from
scratch.

### Skill Plans
The same engine aimed at goals instead of ships. Paste a plan (`<skill name> <level>`,
one per line, roman or digits) and get completion, SP gap, injector count and training
time per character, plus a progress bar on each character's sheet.

Or build one: the **plan creator** puts the training queue on the left and every skill
in the game on the right, grouped the way EVE groups them. **+** and **−** on a skill
queue or drop a level, prerequisites come along in the order they have to be trained,
and each row is priced in SP *and* time with a running "done at" — estimated at a
balanced remap until you tell it what attributes the character will actually have, or
hit **Optimize attributes** to have it rearrange them into the fastest remap this plan
allows (implants included, no free points). A **Ship Browser** searches every hull in
the game and queues everything needed to fly the one you pick.
Each skill group states the primary/secondary pair its skills train against, so only
the ones that break it repeat themselves. Drag rows into the order you want (or sort
them into a valid one in a click), pull in every skill a fit needs — saved or pasted —
then save it as a plan or copy it out for EVE's own skill-plan import.

### Clones
Active implants and every jump clone — custom name, location, implant set — per
character, plus the medical (home) clone. Each row shows clone-jump readiness: the 24h
cooldown reduced by Infomorph Synchronizing, as a countdown chip until it's up.

### Blueprints
A BPO checklist: every blueprint the game has, with the ones you own ticked off, the best
ME/TE across your copies, and who holds each. The default denominator is the ~1,879
market-seeded blueprints that genuinely exist as originals (including the legacy Tech II
BPOs), with invention-only and faction blueprints behind an "include copy-only" toggle.
Only originals earn a tick — ESI reports BPCs through the same endpoint, and MCO won't let
a stack of copies pretend to be a BPO.

Because serious collections live in an **alt corp** hangar, one character per corp can
opt into a single corporation scope and become that corp's reader. Nothing else about the
corporation is read.

### Wallet
This month across every character, one card each: income (everything earned) and the
three categories under it — bounties (NPC bounties + ESS payouts), mission rewards and
corporate reward payouts (CONCORD paying out completed sites, despite the name) — plus
tax paid (every `*_tax`
ref_type plus tax withheld at source; ESI omits corp tax on CONCORD rewards, so it is a
floor), expenses (every `*_fee` plus skill purchases, Ansiblex tolls, repairs and PI
construction — not market escrow, contracts or your own ISK moving), and player
donations in/out — with ISK moved
between your own characters reported separately instead of counted as either. Below
them a stacked by-day income chart, and a collapsible **Previous months** view: a
chart of up to a year of completed months (earnings above the line, tax and donations
sent below it) over a table of the exact figures. History accrues from the first sync
onward — ESI's journal only reaches ~30 days back.

### Notifications
An OS toast and an in-app bell when a character's skill queue is about to run dry —
nothing queued behind the training skill, finishing within 3 days. Deduped per character
and finish date, so re-queueing earns a fresh warning and a repeated sweep doesn't.

### Settings
Sync status (per-character freshness, next due, scheduler state, "Sync all now"),
background-sync preferences, a theme picker (dark, holo, light, void, amber), **demo
mode**, log export, and database backup.

> **Demo mode** swaps character names, account labels, place names, ship names and
> portraits for stable made-up equivalents so you can screenshot or stream MCO without
> exposing your roster. It's display-only — the scrub happens in the layer every page
> reads through, and nothing in the database changes.

---

## How your data gets in

Two sources, both from CCP:

**ESI** (the live API) supplies everything about your characters. You add a character by
clicking **Add character**, which opens EVE's own SSO login in your system browser —
MCO never sees your password. Each character is its own token; there's no "log in as
user", which is exactly why account mapping is manual.

Syncing is **cache-driven, not clock-driven**: a character is due for a refresh when ESI's
own `Expires` header on its skills response says so, and an hourly sweep picks up whoever
is due. That keeps 90 characters polite to CCP's servers by construction. A tray-only
**background mode** keeps that sweep running with the window closed (there's a
"Keep syncing in the tray" setting, and the installer adds an *MCO Background Sync*
Start-menu shortcut).

**The SDE** (Static Data Export) supplies static game data — item types, skills and their
prerequisites, solar systems. MCO downloads and imports it once on first run; a banner
prompts you. Fit and plan analysis need it. It also **checks for newer builds**: EVE
patches in ships and skills between MCO releases, and the banner offers the re-import that
picks them up — no app update required.

---

## Privacy & security

- **Local only.** One SQLite database in your Electron profile folder. No telemetry, no
  sync service, no account.
- **Official SSO, PKCE flow.** MCO never handles your EVE password, and the committed
  client_id is not a secret (that's what PKCE is for).
- **Refresh tokens are encrypted at rest** with Electron `safeStorage`, i.e. your OS
  keychain, scoped to your OS user.
- **Read-only scopes.** MCO never writes anything to your characters.
- **One process per profile.** A single-instance lock is enforced because EVE rotates the
  refresh token on every refresh — two processes racing would invalidate the token family
  and de-auth the character.

Scopes requested when you add a character:

| Scope | Used for |
| --- | --- |
| `esi-skills.read_skills.v1` | Total SP, trained levels — the basis of all fit/plan analysis |
| `esi-skills.read_skillqueue.v1` | Training status, time left, queue-drain warnings |
| `esi-location.read_location.v1` | Current system, docked status |
| `esi-location.read_ship_type.v1` | Current ship |
| `esi-location.read_online.v1` | "Characters online" tile |
| `esi-clones.read_clones.v1` | Jump clones, medical clone |
| `esi-clones.read_implants.v1` | Active implants |
| `esi-characters.read_fatigue.v1` | Jump fatigue timers |
| `esi-wallet.read_character_wallet.v1` | Wallet balance and the Wallet page's journal categories |
| `esi-universe.read_structures.v1` | Resolving player-owned citadel names |
| `esi-characters.read_blueprints.v1` | The blueprint checklist |

**Not** in that grant: `esi-corporations.read_blueprints.v1`. It's the one corporation
scope MCO takes, it's requested per character on demand from the Blueprints page, and it
exists solely because alt-corp hangars are where blueprint collections actually live.
MCO is not a corporation tool and reads nothing else corporate.

---

## Install

Download the current build from [Releases](https://github.com/Anemone221/MCO/releases):

| Platform | File |
| --- | --- |
| Windows 10/11 | `MCO-Setup-<version>.exe` |
| macOS — Apple silicon | `MCO-<version>-arm64.dmg` |
| macOS — Intel | `MCO-<version>-x64.dmg` |

MCO is not code-signed on either platform — the project has no signing certificate yet —
so each one wants one extra step the first time.

### Windows

SmartScreen warns about an unknown publisher: **More info → Run anyway**. That is the only
time it asks. From then on MCO updates itself: it says when a release lands, downloads it
when you click, and installs it on the next restart.

### macOS

The macOS build is currently unsigned. After dragging MCO to **Applications**, the first
launch will fail with:

> **"MCO" is damaged and can't be opened. You should move it to the Trash.**

Nothing is damaged — that is Gatekeeper refusing a quarantined app it can't verify. Clear
the quarantine flag from a terminal:

```sh
xattr -c /Applications/MCO.app
```

Then launch normally. (Apple requires apps be
[signed & notarized](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution);
this project doesn't have a signing identity yet.)

For the same reason, macOS builds don't install updates in place: MCO still tells you when
a release lands and links to it, but the new DMG is a manual download.

### Build from source instead

**Requirements:** Node.js ≥ 20.19 and git.

```bash
git clone https://github.com/Anemone221/MCO.git
cd MCO
npm ci        # postinstall rebuilds better-sqlite3 against Electron
npm run dev   # launch with hot reload
```

To build a real installer: `npm run dist` (output in `release/`). On Windows this
can trip over an electron-builder toolchain symlink error — see the fix in
[docs/development.md](docs/development.md#windows-packaging-wincodesign-symlink-error).

### First run, in order

1. **Import the SDE** when the banner offers it. One download of EVE's static data; names
   and all fit/plan analysis depend on it.
2. **Add your characters** from the Roster page. Each one opens an EVE SSO login in your
   browser; repeat per character. (Yes, 90 times — once.)
3. **Create accounts** on the Accounts page and assign each character to one. This is what
   makes "which account is idle" answerable. Tick Omega where it applies.
4. **Paste a fit or two** on the Fits page, then use the bulk tag button on the "Can fly
   fully" section to tag everyone who qualifies — the fastest path to a fully tagged
   roster.
5. **Build groups** for the fleets and roles you actually run, and give each one a
   priority fit or plan.
6. Optionally: **Import structures** from the Location page to resolve citadel names, and
   turn on **background sync** in Settings so data stays fresh without the window open.

### Where your data lives

In Electron's `userData` directory for MCO (`%APPDATA%\MCO` on Windows,
`~/Library/Application Support/MCO` on macOS, `~/.config/MCO` on Linux) — Settings →
**Open data folder** takes you there:

- `mco.sqlite` — everything: characters, encrypted tokens, skills, SDE, caches.
- `sde-cache/sde.zip` — the downloaded static-data archive.

Settings → **Back up database…** writes a consistent snapshot while the app keeps running.
To restore, quit MCO and copy the file back. Note that refresh tokens are encrypted per OS
user, so a backup restored on another machine keeps all your data but needs the characters
re-added.

### Using your own EVE application

MCO ships with its own developer client_id. To use yours, register an app at
[developers.eveonline.com](https://developers.eveonline.com/) with callback
`http://localhost:8765/callback` and the scopes listed in `ESI_SCOPES`
([`src/main/config.ts`](src/main/config.ts)) — plus `esi-corporations.read_blueprints.v1`
if you want the alt-corp feature — then set `MCO_ESI_CLIENT_ID`. `MCO_SDE_URL` pins an
exact SDE zip the same way, instead of the build CCP's catalogue names.

---

## Contributing / hacking on it

Electron + TypeScript (strict) + React 19, SQLite via better-sqlite3, built with
electron-vite, tested with vitest and Playwright.

```bash
npm run typecheck && npm run lint && npm run test:unit   # fast checks
npm run test:e2e                                         # real-app tests
```

The renderer is sandboxed and reaches the main process only through a typed IPC bridge;
all SQL lives in repositories, all ESI calls go through one client, and the interesting
logic (EFT parsing, SP math, filtering) is kept pure so it's testable without Electron.
[`CLAUDE.md`](CLAUDE.md) is the condensed contributor manual — read it first; the details
live in [`docs/`](docs/README.md):

| Doc | Covers |
| --- | --- |
| [architecture.md](docs/architecture.md) | Process model, IPC pattern, launch modes, layering |
| [esi.md](docs/esi.md) | SSO/PKCE, token storage, the ESI client, caching, rate limiting |
| [database.md](docs/database.md) | SQLite setup, migrations, full schema |
| [sde.md](docs/sde.md) | Static Data Export download/import pipeline |
| [features.md](docs/features.md) | Every page in depth + the skill-analysis engine |
| [development.md](docs/development.md) | Scripts, env vars, testing, CI, packaging |
| [code-style.md](docs/code-style.md) | Conventions the codebase already follows |
| [improvement-plan.md](docs/improvement-plan.md) | Path to shippable binaries, hardening, test gaps |
| [optimization.md](docs/optimization.md) | Performance headroom for large rosters |

Issues and PRs go to [github.com/Anemone221/MCO](https://github.com/Anemone221/MCO).

---

## Legal

MCO is an unofficial, third-party tool, built on CCP's ESI API and Static Data Export
under the [EVE Developer License Agreement](https://developers.eveonline.com/license-agreement).
It is not affiliated with, endorsed by, or supported by CCP hf. MCO is free and
non-commercial; it reads only the characters you personally log in, and it never sees your
EVE password (login goes through CCP's own SSO in your system browser).

MCO's own source code is [MIT licensed](LICENSE). EVE Online game assets are not — the
app icon derives from CCP artwork used under the Developer License Agreement; see the
provenance note in [docs/development.md](docs/development.md#app-icons) before reusing it.

> EVE Online, the EVE logo, EVE and all associated logos and designs are the intellectual
> property of CCP hf. All artwork, screenshots, characters, vehicles, storylines, world
> facts or other recognizable features of the intellectual property relating to these
> trademarks are likewise the intellectual property of CCP hf. EVE Online and the EVE logo
> are the registered trademarks of CCP hf. All rights are reserved worldwide. All other
> trademarks are the property of their respective owners. CCP hf. has granted permission to
> MCO to use EVE Online and all associated logos and designs for promotional and information
> purposes but does not endorse, and is not in any way affiliated with, MCO. CCP is in no way
> responsible for the content on or functioning of this program, nor can it be liable for any
> damage arising from the use of this program.

The same notice is shown in the app under **Settings → About**; keep the two in step.
