# MCO — Massive Character Organization

A desktop tool for EVE Online players who run a **lot** of characters (10+, built for
90+). MCO keeps your whole roster organized outside the game: who's training what,
which account is idle, who can fly a given fit, where everyone is parked, and which
clones hold which implants.

## Features

- **Roster** — every character in one dense, sortable, filterable table: account,
  capability tags, location, ship, training skill + time left, jump fatigue, total SP,
  last sync. Toggleable columns.
- **Accounts** — map characters to their accounts so you can see at a glance which
  accounts are training and which are wasting time.
- **Groups** — optional, user-defined organizational units ("WH defense", a
  supercapital fleet). Characters can be in none or many.
- **Tags** — capabilities at the character level ("Is able to Cyno", "Is able to
  Fax"), independent of any group; assign from the Tags page or by right-clicking on
  the Roster.
- **Fit testing** — paste an EFT fit and see which characters can fly it, and the
  exact missing skills / SP gap (prerequisites included) for those who can't.
- **Skill plans** — paste a skill plan and track completion and SP gap per character,
  with progress on each character's sheet.
- **Location board** — last-known system (security color-coded), region, docked
  status, and ship for the whole roster.
- **Clones & implants** — active implants and every jump clone (name, location,
  implant set) per character.
- **Notifications** — OS toast + in-app alert when a skill queue is about to run dry
  (within 3 days, nothing queued behind it).
- **Background sync** — an hourly sync respects ESI's own cache windows; a tray-only
  background mode (`--background`) keeps data fresh without a window.

Character data comes from EVE's ESI API via the official SSO login (OAuth2 + PKCE, in
your system browser — MCO never sees your password). Refresh tokens are encrypted with
your OS keychain. Static game data comes from CCP's Static Data Export, imported once
on first run.

## Getting started (from source)

Requires Node.js ≥ 20.19.

```bash
npm ci
npm run dev
```

Then, in the app:

1. **Import the SDE** when the banner prompts you (one-time download of EVE's static
   data — needed for names and fit/plan analysis).
2. **Add characters** from the Roster page — each opens an EVE SSO login in your
   browser.
3. Assign characters to accounts, tag capabilities, build groups, paste fits & plans.

To build an installer: `npm run dist` (output in `release/`).

By default MCO uses its committed EVE developer application id. To use your own, register
an app at [developers.eveonline.com](https://developers.eveonline.com/) (callback
`http://localhost:8765/callback`, scopes in `src/main/config.ts`) and set
`MCO_ESI_CLIENT_ID`.

## Tech

Electron + TypeScript + React, SQLite (better-sqlite3), electron-vite, vitest +
Playwright. Developer docs live in [`docs/`](docs/README.md); the condensed contributor
manual is [`CLAUDE.md`](CLAUDE.md).

```bash
npm run typecheck && npm run lint && npm run test:unit   # fast checks
npm run test:e2e                                         # real-app tests
```

## Legal

MCO is an unofficial, third-party tool. EVE Online and all related data are the property
of [CCP hf.](https://www.ccpgames.com/); usage of ESI and the SDE is subject to CCP's
developer license agreement.
