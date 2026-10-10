import { IpcChannel } from '@shared/ipc';
import { SCOPE_READ_IMPLANTS, SCOPE_READ_ONLINE } from '../config';
import { grantedScopes } from '../auth/token-store';
import { findCriticalMatch, implantSetKey } from '../clones/criticalImplants';
import { getFlag, setFlag } from '../db/repositories/appSettings';
import { listCharacters } from '../db/repositories/characters';
import {
  listCharacterLocations,
  upsertCharacterLocation,
} from '../db/repositories/characterLocation';
import { listCharacterOnline, upsertCharacterOnline } from '../db/repositories/characterOnline';
import { getAllActiveImplants, replaceActiveImplants } from '../db/repositories/clones';
import { getAllCriticalImplantSets } from '../db/repositories/criticalImplants';
import { getSystems } from '../db/repositories/sde';
import { getInvalidTokenIds } from '../db/repositories/tokens';
import {
  getCharacterImplants,
  getCharacterLocation,
  getCharacterOnline,
  getCharacterShip,
} from '../esi/endpoints';
import { observeDocking, type ExposureState } from '../notifications/criticalUndock';
import { deliverNotifications, type GetWindow } from './notificationDelivery';
import { resolveStructures } from './structureService';

/**
 * Live tracking: the fast lane beside the hourly sweep.
 *
 * Two loops, both cheap by construction because `esiGet` answers from the
 * esi_cache without a request while ESI's own `Expires` window is open:
 *
 *  - **Presence** — every {@link PRESENCE_INTERVAL_MS}, `/online` for every
 *    character whose token carries the online scope. ESI caches it for 60 s,
 *    so polling faster buys nothing. A 90+ roster costs ~45 requests a minute.
 *  - **Active** — every {@link ACTIVE_INTERVAL_MS}, only for characters the
 *    presence loop last saw online: location + ship (ESI cache 5 s) and active
 *    implants (ESI cache ~2 min, so most ticks are cache hits). This is what
 *    keeps the Location board current for the characters actually being flown,
 *    and it is what drives the critical-clone undock warning.
 *
 * Offline characters stay on the hourly sweep: their location cannot change.
 *
 * Both loops run on their own timers, independent of the hourly sweep: a login
 * is noticed within one presence interval, not at the next sweep. The whole
 * lane can be switched off in Settings ({@link LIVE_TRACKING_KEY}); the hourly
 * sweep still reads online status and location then, just hourly.
 */
const PRESENCE_INTERVAL_MS = 2 * 60 * 1000;
const ACTIVE_INTERVAL_MS = 20 * 1000;
/** Offset the first presence poll from the hourly sweep's own startup delay. */
const PRESENCE_STARTUP_DELAY_MS = 30_000;

/** app_settings flag; absent = on. */
const LIVE_TRACKING_KEY = 'live_tracking';

/** Set while the scheduler is running, so the Settings toggle can arm the loops itself. */
let currentGetWindow: GetWindow | null = null;

let presenceTimer: NodeJS.Timeout | null = null;
let activeTimer: NodeJS.Timeout | null = null;
let startupTimer: NodeJS.Timeout | null = null;

/** Per-character docking state, for online characters only (see criticalUndock.ts). */
const exposures = new Map<number, ExposureState>();

/**
 * Single-flight per loop: a tick can outlast its interval when the rate limiter
 * is backing off or the hourly sweep is holding the request queue, and two
 * overlapping ticks would double every request for nothing.
 */
let presenceInFlight = false;
let activeInFlight = false;

function hasScope(characterId: number, scope: string): boolean {
  return grantedScopes(characterId).includes(scope);
}

/** Characters whose token can still be refreshed. */
function trackableCharacterIds(): number[] {
  const invalid = getInvalidTokenIds();
  return listCharacters()
    .map((c) => c.id)
    .filter((id) => !invalid.has(id));
}

/** Poll `/online` for everyone; returns true when any character's status changed. */
async function pollPresence(): Promise<boolean> {
  const previous = new Map(listCharacterOnline().map((o) => [o.characterId, o.online]));
  const ids = trackableCharacterIds().filter((id) => hasScope(id, SCOPE_READ_ONLINE));
  let changed = false;

  await Promise.all(
    ids.map(async (characterId) => {
      try {
        const status = await getCharacterOnline(characterId);
        upsertCharacterOnline(
          characterId,
          status.online,
          status.last_login ?? null,
          status.last_logout ?? null,
        );
        if (previous.get(characterId) !== status.online) changed = true;
        // Logged off: the next login starts a fresh exposure history.
        if (!status.online) exposures.delete(characterId);
      } catch (err) {
        console.warn(`[live] online check failed for character ${characterId}:`, err);
      }
    }),
  );
  return changed;
}

/** Observe one online character; returns true when stored data changed. */
async function observeCharacter(
  characterId: number,
  getWindow: GetWindow,
  nowIso: string,
): Promise<boolean> {
  let changed = false;

  // Implants first: when the undock check below runs, it should see the pod
  // the character is wearing now, not the one from before a clone jump.
  let implants = getAllActiveImplants().get(characterId) ?? [];
  if (hasScope(characterId, SCOPE_READ_IMPLANTS)) {
    const fresh = await getCharacterImplants(characterId);
    if (implantSetKey(fresh) !== implantSetKey(implants)) {
      replaceActiveImplants(characterId, fresh);
      changed = true;
    }
    implants = fresh;
  }

  const [location, ship] = await Promise.all([
    getCharacterLocation(characterId),
    getCharacterShip(characterId),
  ]);
  const next = {
    characterId,
    solarSystemId: location.solar_system_id,
    stationId: location.station_id ?? null,
    structureId: location.structure_id ?? null,
    shipTypeId: ship.ship_type_id,
    shipName: ship.ship_name,
  };
  const prev = listCharacterLocations().find((l) => l.characterId === characterId);
  if (
    !prev ||
    prev.solarSystemId !== next.solarSystemId ||
    prev.stationId !== next.stationId ||
    prev.structureId !== next.structureId ||
    prev.shipTypeId !== next.shipTypeId ||
    prev.shipName !== next.shipName
  ) {
    upsertCharacterLocation(next);
    changed = true;
    if (next.structureId !== null) await resolveStructures(characterId, [next.structureId]);
  }

  const docked = next.stationId !== null || next.structureId !== null;
  const state = observeDocking(exposures.get(characterId), docked, nowIso);
  exposures.set(characterId, state);
  if (state.exposureStart !== null) {
    warnIfCritical(characterId, implants, next.solarSystemId, state.exposureStart, getWindow);
  }

  return changed;
}

/** Raise the critical-clone warning if the worn pod matches a critical set. */
function warnIfCritical(
  characterId: number,
  implants: number[],
  solarSystemId: number,
  exposureStart: string,
  getWindow: GetWindow,
): void {
  const sets = getAllCriticalImplantSets().get(characterId) ?? [];
  if (sets.length === 0) return;
  const matchKey = findCriticalMatch(
    implants,
    sets.map((s) => s.implantKey),
  );
  if (matchKey === null) return;

  const character = listCharacters().find((c) => c.id === characterId);
  const name = character?.name ?? `Character ${characterId}`;
  const label = sets.find((s) => s.implantKey === matchKey)?.label ?? null;
  const system = getSystems([solarSystemId]).get(solarSystemId)?.name ?? null;
  const pod = label ? `critical clone "${label}"` : 'a critical clone';

  deliverNotifications(
    [
      {
        kind: 'critical-undock',
        // The exposure start names this trip out of the station: one warning
        // per undock, however many ticks it stays in space.
        dedupeKey: `critical-undock:${characterId}:${exposureStart}`,
        characterId,
        title: `${name}: undocked in a critical clone`,
        body: `${name} is in space wearing ${pod}${system ? ` in ${system}` : ''}.`,
      },
    ],
    getWindow,
  );
}

async function runPresenceTick(getWindow: GetWindow): Promise<void> {
  if (presenceInFlight) return;
  presenceInFlight = true;
  try {
    if (await pollPresence()) getWindow()?.webContents.send(IpcChannel.charactersChanged);
  } catch (err) {
    console.error('[live] presence tick failed:', err);
  } finally {
    presenceInFlight = false;
  }
}

async function runActiveTick(getWindow: GetWindow): Promise<void> {
  if (activeInFlight) return;
  activeInFlight = true;
  try {
    const trackable = new Set(trackableCharacterIds());
    const online = listCharacterOnline()
      .filter((o) => o.online && trackable.has(o.characterId))
      .map((o) => o.characterId);
    if (online.length === 0) return;

    const nowIso = new Date().toISOString();
    const results = await Promise.allSettled(
      online.map((id) => observeCharacter(id, getWindow, nowIso)),
    );
    let changed = false;
    for (const [i, r] of results.entries()) {
      if (r.status === 'fulfilled') changed ||= r.value;
      else console.warn(`[live] observe failed for character ${online[i]}:`, r.reason);
    }
    // Only on a real change: every open page reloads on this event, and an
    // unchanged character docked in a station would otherwise cost a full
    // reload every 20 seconds.
    if (changed) getWindow()?.webContents.send(IpcChannel.charactersChanged);
  } catch (err) {
    console.error('[live] active tick failed:', err);
  } finally {
    activeInFlight = false;
  }
}

function armLoops(getWindow: GetWindow): void {
  if (presenceTimer) return;
  startupTimer = setTimeout(() => void runPresenceTick(getWindow), PRESENCE_STARTUP_DELAY_MS);
  presenceTimer = setInterval(() => void runPresenceTick(getWindow), PRESENCE_INTERVAL_MS);
  activeTimer = setInterval(() => void runActiveTick(getWindow), ACTIVE_INTERVAL_MS);
}

function disarmLoops(): void {
  if (startupTimer) clearTimeout(startupTimer);
  if (presenceTimer) clearInterval(presenceTimer);
  if (activeTimer) clearInterval(activeTimer);
  startupTimer = presenceTimer = activeTimer = null;
  // A tick already in flight finishes; the next arm starts a fresh exposure
  // history rather than comparing against state from before the pause.
  exposures.clear();
}

export function isLiveTrackingEnabled(): boolean {
  return getFlag(LIVE_TRACKING_KEY, true);
}

/**
 * Persist the Settings toggle and apply it now: turning it on arms the loops
 * straight away (if the scheduler is running), turning it off stops them.
 */
export function setLiveTrackingEnabled(enabled: boolean): boolean {
  setFlag(LIVE_TRACKING_KEY, enabled);
  if (!enabled) disarmLoops();
  else if (currentGetWindow) armLoops(currentGetWindow);
  return isLiveTrackingEnabled();
}

/** Called with the scheduler's start: arms the loops unless switched off in Settings. */
export function startLiveTracking(getWindow: GetWindow): void {
  currentGetWindow = getWindow;
  if (isLiveTrackingEnabled()) armLoops(getWindow);
}

export function stopLiveTracking(): void {
  currentGetWindow = null;
  disarmLoops();
}
