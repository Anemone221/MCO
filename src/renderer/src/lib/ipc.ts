import type { McoApi } from '@shared/ipc';
import { cleanIpcErrorMessage } from '@shared/ipcError';
import {
  demoAccount,
  demoAppInfo,
  demoBlueprintBoard,
  demoCharacterDetail,
  demoCloneBoardEntry,
  demoDashboardSummary,
  demoFitAnalysis,
  demoGroup,
  demoGroupDetail,
  demoLocationEntry,
  demoNearestBoard,
  demoNotification,
  demoPlanAnalysis,
  demoRosterEntry,
  demoStructureResult,
  demoSyncStatus,
  demoSystemResult,
  isDemoMode,
} from './demo';

/** The preload-exposed main-process API. */
const real: McoApi = window.mco;

/**
 * The text to show for a failed call — use this in a page's `catch`, never
 * `String(e)`. Main decides what a failure may say and the preload unwraps it
 * (see `src/main/errors.ts`); this is the last step, dropping the `Error: `
 * that `String()` would prepend to an otherwise finished sentence.
 */
export function errorMessage(err: unknown): string {
  return cleanIpcErrorMessage(err);
}

/** Apply a demo-mode scrub to a result, or pass it through untouched. */
async function scrubbed<T>(result: Promise<T>, scrub: (value: T) => T): Promise<T> {
  const value = await result;
  return isDemoMode() ? scrub(value) : value;
}

/**
 * Notifications carry character/system names inside free text, so the demo
 * scrub needs the real→fake aliases the roster scrub registers. Force them.
 */
async function primeDemoAliases(): Promise<void> {
  (await real.characters.roster()).forEach(demoRosterEntry);
}

/**
 * The preload API, with every identifying view model scrubbed when demo mode
 * is on (see lib/demo.ts) — pages import this instead of window.mco so the
 * scrub cannot be bypassed by a new page forgetting about demo mode.
 */
export const mco: McoApi = {
  ...real,
  characters: {
    ...real.characters,
    roster: () => scrubbed(real.characters.roster(), (r) => r.map(demoRosterEntry)),
    detail: (characterId) => scrubbed(real.characters.detail(characterId), demoCharacterDetail),
  },
  accounts: {
    ...real.accounts,
    list: () => scrubbed(real.accounts.list(), (a) => a.map(demoAccount)),
  },
  groups: {
    ...real.groups,
    list: () => scrubbed(real.groups.list(), (g) => g.map(demoGroup)),
    detail: (groupId) => scrubbed(real.groups.detail(groupId), demoGroupDetail),
  },
  fits: {
    ...real.fits,
    analyze: (fitId) => scrubbed(real.fits.analyze(fitId), demoFitAnalysis),
  },
  plans: {
    ...real.plans,
    analyze: (planId) => scrubbed(real.plans.analyze(planId), demoPlanAnalysis),
  },
  location: {
    board: () => scrubbed(real.location.board(), (b) => b.map(demoLocationEntry)),
    // Every parameter has to be named and forwarded: a wrapper that declares
    // fewer still satisfies `McoApi` (TypeScript allows it), so a dropped
    // argument compiles cleanly and silently disables whatever it controls.
    nearest: (solarSystemId, includeJumpClones) =>
      scrubbed(real.location.nearest(solarSystemId, includeJumpClones), demoNearestBoard),
  },
  structures: {
    ...real.structures,
    search: (query) => scrubbed(real.structures.search(query), (r) => r.map(demoStructureResult)),
  },
  systems: {
    search: (query) => scrubbed(real.systems.search(query), (r) => r.map(demoSystemResult)),
  },
  clones: {
    board: () => scrubbed(real.clones.board(), (b) => b.map(demoCloneBoardEntry)),
  },
  blueprints: {
    ...real.blueprints,
    board: () => scrubbed(real.blueprints.board(), demoBlueprintBoard),
    refresh: () => scrubbed(real.blueprints.refresh(), demoBlueprintBoard),
    addCorp: () => scrubbed(real.blueprints.addCorp(), demoBlueprintBoard),
  },
  dashboard: {
    summary: () => scrubbed(real.dashboard.summary(), demoDashboardSummary),
  },
  notifications: {
    ...real.notifications,
    list: async () => {
      const list = await real.notifications.list();
      if (!isDemoMode()) return list;
      await primeDemoAliases();
      return list.map(demoNotification);
    },
  },
  system: {
    ...real.system,
    appInfo: () => scrubbed(real.system.appInfo(), demoAppInfo),
  },
  settings: {
    ...real.settings,
    syncStatus: () => scrubbed(real.settings.syncStatus(), demoSyncStatus),
  },
};
