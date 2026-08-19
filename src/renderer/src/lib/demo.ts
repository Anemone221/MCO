import type {
  AccountBucket,
  AppInfo,
  AppNotification,
  BlueprintBoard,
  BlueprintHolder,
  CharacterDetail,
  CharacterGroup,
  CharacterSummary,
  CloneBoardEntry,
  CloneLocation,
  DashboardSummary,
  FitAnalysis,
  GroupDetail,
  JumpCloneEntry,
  LocationEntry,
  NearestBoard,
  PlanAnalysis,
  RosterEntry,
  StructureSearchResult,
  SyncStatusReport,
  SystemSearchResult,
} from '@shared/types';

/**
 * Demo mode: replaces identifying data (character names, account labels,
 * system/region/station names, portraits, OS paths) with made-up equivalents
 * so screenshots don't expose the user's roster. Display-only — the scrub
 * happens in `lib/ipc.ts` on data leaving the preload API; nothing in the
 * database changes.
 *
 * Mappings are deterministic (hash of the real id/name picks from a pool) and
 * collision-free within a session, so the same character keeps the same fake
 * name across pages and tables stay distinguishable.
 */

export const DEMO_STORAGE_KEY = 'mco-demo-mode';

export function isDemoMode(): boolean {
  try {
    return localStorage.getItem(DEMO_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setDemoMode(on: boolean): void {
  try {
    localStorage.setItem(DEMO_STORAGE_KEY, on ? '1' : '0');
  } catch {
    // storage unavailable — demo mode stays off (isDemoMode reads storage)
  }
}

// ---------------------------------------------------------------------------
// Deterministic assignment

function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

interface Assigner {
  cache: Map<string, string>;
  used: Set<string>;
  /** Size of the pool `make` draws from. */
  size: number;
  make: (index: number) => string;
}

function makeAssigner(size: number, make: (index: number) => string): Assigner {
  return { cache: new Map(), used: new Set(), size, make };
}

/**
 * Deterministically map `key` into the assigner's pool, probing past values
 * already taken by other keys so no two keys share a fake name.
 */
function assign(assigner: Assigner, key: string): string {
  const hit = assigner.cache.get(key);
  if (hit !== undefined) return hit;
  let index = fnv1a(key) % assigner.size;
  for (let tries = 0; tries < assigner.size; tries++) {
    const candidate = assigner.make(index);
    if (!assigner.used.has(candidate)) {
      assigner.used.add(candidate);
      assigner.cache.set(key, candidate);
      return candidate;
    }
    index = (index + 1) % assigner.size;
  }
  // Pool exhausted — suffix a counter to stay unique.
  const fallback = `${assigner.make(fnv1a(key) % assigner.size)} ${assigner.cache.size + 1}`;
  assigner.used.add(fallback);
  assigner.cache.set(key, fallback);
  return fallback;
}

/** Real → fake strings seen so far, for scrubbing free text (notifications). */
const aliases = new Map<string, string>();

function remember(real: string | null | undefined, fake: string): void {
  if (real && real !== fake) aliases.set(real, fake);
}

// ---------------------------------------------------------------------------
// Name pools (invented — any match with real EVE names is coincidence)

const FIRST_NAMES = [
  'Avira', 'Bex', 'Caldan', 'Dara', 'Edek', 'Fenn', 'Galia', 'Haro',
  'Ishka', 'Jorin', 'Kesse', 'Lyra', 'Maren', 'Nyx', 'Orven', 'Pella',
  'Quorra', 'Rezan', 'Sable', 'Tavik', 'Ulyss', 'Vex', 'Wrena', 'Xalor',
  'Ysari', 'Zeph', 'Astra', 'Brakk', 'Cyra', 'Dov', 'Elix', 'Faye',
];

const LAST_NAMES = [
  'Voss', 'Adare', 'Brenn', 'Corvane', 'Dredd', 'Ellek', 'Farrow', 'Grath',
  'Hollen', 'Ixin', 'Jaxa', 'Kerev', 'Lorne', 'Maddox', 'Nerak', 'Oskold',
  'Pryce', 'Quill', 'Rennick', 'Skarr', 'Tyrell', 'Ursen', 'Vahl', 'Wexley',
  'Yaren', 'Zorav', 'Ashvale', 'Blackmar', 'Calder', 'Draven', 'Ferros', 'Galv',
];

const SYSTEMS = [
  'Auvern', 'Beshkar', 'Cindera', 'Delvos', 'Eshtai', 'Ferune', 'Ghesis', 'Hakoro',
  'Ilvane', 'Joras', 'Kavesh', 'Lumire', 'Mervas', 'Norrek', 'Ostrande', 'Palvos',
  'Quoris', 'Ravene', 'Sorvane', 'Tashkel', 'Uvora', 'Velsara', 'Wexen', 'Yarrow',
  'Zeruel', 'Ambrere', 'Boldur', 'Cresta', 'Doriane', 'Evasse', 'Fionne', 'Gerbold',
];

const REGIONS = [
  'The Ashen Verge', 'Corelum Expanse', 'Duskmarch', 'Ebonvale',
  'Farrow Cluster', 'Glass Meridian', 'Hallowed Drift', 'Ivory Reach',
  'Kestrel Span', 'Lumen Sound', 'Mirrorfall', 'Nocturne Belt',
  'Opal Corridor', 'Palewater', 'Quiet Ruin', 'Starke Divide',
];

const STATION_CORPS = [
  'Veyline Logistics', 'Kestrel Freight', 'Orvo Dynamics', 'Halcyon Combine',
  'Nadir Syndicate', 'Bluewake Industries', 'Ferron Trust', 'Skyforge Union',
];

const STATION_FACILITIES = [
  'Trading Post', 'Assembly Plant', 'Refinery', 'Testing Facilities',
  'Warehouse', 'Reprocessing Facility', 'Logistic Support', 'Academy',
];

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];

const ACCOUNT_WORDS = [
  'Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel',
  'India', 'Juliett', 'Kilo', 'Lima', 'Mike', 'November', 'Oscar', 'Papa',
  'Quebec', 'Romeo', 'Sierra', 'Tango', 'Uniform', 'Victor', 'Whiskey', 'Yankee',
];

/** Indexed pool access that satisfies noUncheckedIndexedAccess. */
function pick(pool: string[], index: number): string {
  return pool[index % pool.length] ?? '';
}

const characterNames = makeAssigner(
  FIRST_NAMES.length * LAST_NAMES.length,
  (i) => `${pick(FIRST_NAMES, i)} ${pick(LAST_NAMES, Math.floor(i / FIRST_NAMES.length))}`,
);

const systemNames = makeAssigner(SYSTEMS.length, (i) => pick(SYSTEMS, i));

const regionNames = makeAssigner(REGIONS.length, (i) => pick(REGIONS, i));

// system × planet × moon × corp × facility — comfortably larger than any roster.
const stationNames = makeAssigner(
  SYSTEMS.length * ROMAN.length * 12 * STATION_CORPS.length * STATION_FACILITIES.length,
  (i) => {
    const system = pick(SYSTEMS, i);
    const planet = pick(ROMAN, Math.floor(i / SYSTEMS.length));
    const moon = (Math.floor(i / (SYSTEMS.length * ROMAN.length)) % 12) + 1;
    const corp = pick(STATION_CORPS, Math.floor(i / (SYSTEMS.length * ROMAN.length * 12)));
    const facility = pick(
      STATION_FACILITIES,
      Math.floor(i / (SYSTEMS.length * ROMAN.length * 12 * STATION_CORPS.length)),
    );
    return `${system} ${planet} - Moon ${moon} - ${corp} ${facility}`;
  },
);

const accountLabels = makeAssigner(ACCOUNT_WORDS.length, (i) => `Account ${pick(ACCOUNT_WORDS, i)}`);

/** Alt-corp names reuse the station-corp pool — they read like corporations. */
const corpNames = makeAssigner(STATION_CORPS.length, (i) => pick(STATION_CORPS, i));

// ---------------------------------------------------------------------------
// Field scrubbers

/** Fake character name, stable per character id. */
export function demoCharacterName(characterId: number, realName?: string | null): string {
  const fake = assign(characterNames, `char:${characterId}`);
  remember(realName, fake);
  return fake;
}

export function demoAccountLabel(label: string | null): string | null {
  if (label === null) return null;
  const fake = assign(accountLabels, label);
  remember(label, fake);
  return fake;
}

export function demoSystemName(name: string | null): string | null {
  if (name === null) return null;
  const fake = assign(systemNames, name);
  remember(name, fake);
  return fake;
}

export function demoRegionName(name: string | null): string | null {
  if (name === null) return null;
  return assign(regionNames, name);
}

/** Fake station/structure name (keyed by the real name). */
export function demoLocationName(name: string | null): string | null {
  if (name === null) return null;
  const fake = assign(stationNames, name);
  remember(name, fake);
  return fake;
}

/** EVE's default ship-name style, built from the pilot's fake name. */
function demoShipName(characterId: number, shipTypeName: string | null): string {
  const first = demoCharacterName(characterId).split(' ')[0] ?? 'Pilot';
  return `${first}'s ${shipTypeName ?? 'Ship'}`;
}

/** Replace every real name seen so far inside free text (notification title/body). */
export function demoText(text: string): string {
  let out = text;
  for (const [real, fake] of aliases) {
    if (out.includes(real)) out = out.split(real).join(fake);
  }
  return out;
}

/** Mask the OS user name in absolute paths (Settings → About/Backup). */
export function demoPath(path: string): string {
  return path
    .replace(/([\\/]Users[\\/])[^\\/]+/, '$1demo')
    .replace(/([\\/]home[\\/])[^\\/]+/, '$1demo');
}

// ---------------------------------------------------------------------------
// View-model scrubbers (one per identifying endpoint, applied in lib/ipc.ts)

function demoSummary(character: CharacterSummary): CharacterSummary {
  return { ...character, name: demoCharacterName(character.id, character.name) };
}

function demoCloneLocation(clone: CloneLocation | null): CloneLocation | null {
  if (clone === null) return null;
  return { ...clone, locationName: demoLocationName(clone.locationName) };
}

function demoJumpClone(clone: JumpCloneEntry): JumpCloneEntry {
  return { ...clone, locationName: demoLocationName(clone.locationName) };
}

export function demoRosterEntry(entry: RosterEntry): RosterEntry {
  return {
    ...entry,
    character: demoSummary(entry.character),
    accountLabel: demoAccountLabel(entry.accountLabel),
    systemName: demoSystemName(entry.systemName),
  };
}

export function demoCharacterDetail(detail: CharacterDetail): CharacterDetail {
  return {
    ...detail,
    character: demoSummary(detail.character),
    location: detail.location && {
      ...detail.location,
      solarSystemName: demoSystemName(detail.location.solarSystemName),
    },
    ship: detail.ship && {
      ...detail.ship,
      name: demoShipName(detail.character.id, detail.ship.typeName),
    },
    clones: detail.clones.map(demoJumpClone),
    medicalClone: demoCloneLocation(detail.medicalClone),
  };
}

export function demoAccount(account: AccountBucket): AccountBucket {
  return { ...account, label: demoAccountLabel(account.label) ?? account.label };
}

export function demoGroup(group: CharacterGroup): CharacterGroup {
  return {
    ...group,
    homeStationName: demoLocationName(group.homeStationName),
    podSystems: group.podSystems.map((p) => ({
      ...p,
      systemName: demoSystemName(p.systemName) ?? p.systemName,
    })),
  };
}

export function demoGroupDetail(detail: GroupDetail): GroupDetail {
  return {
    ...detail,
    group: demoGroup(detail.group),
    members: detail.members.map((m) => ({
      ...m,
      character: demoSummary(m.character),
      accountLabel: demoAccountLabel(m.accountLabel),
      systemName: demoSystemName(m.systemName),
      medicalClone: demoCloneLocation(m.medicalClone),
    })),
    podViolations: detail.podViolations.map((p) => ({
      ...p,
      characterName: demoCharacterName(p.characterId, p.characterName),
      systemName: demoSystemName(p.systemName),
      locationName: demoLocationName(p.locationName),
    })),
    podIgnored: detail.podIgnored.map((p) => ({
      ...p,
      characterName: demoCharacterName(p.characterId, p.characterName),
      systemName: demoSystemName(p.systemName),
      locationName: demoLocationName(p.locationName),
    })),
  };
}

/**
 * Generic over the entry type so the proximity ranking — a location entry plus
 * its distances — scrubs through the same function rather than a near-copy
 * that could drift from it.
 */
export function demoLocationEntry<T extends LocationEntry>(entry: T): T {
  return {
    ...entry,
    characterName: demoCharacterName(entry.characterId, entry.characterName),
    accountLabel: demoAccountLabel(entry.accountLabel),
    systemName: demoSystemName(entry.systemName),
    regionName: demoRegionName(entry.regionName),
    dockedName: demoLocationName(entry.dockedName),
    shipName: entry.shipName === null ? null : demoShipName(entry.characterId, entry.shipTypeName),
  };
}

export function demoNearestBoard(board: NearestBoard): NearestBoard {
  return {
    ...board,
    target: demoSystemResult(board.target),
    entries: board.entries.map((entry) => ({
      ...demoLocationEntry(entry),
      // A clone's own name is player-written and its station names a place as
      // surely as a docked location does, so both go through the same scrub.
      clones: entry.clones.map((clone) => ({
        ...clone,
        name: clone.name === null ? null : (demoLocationName(clone.name) ?? clone.name),
        locationName: demoLocationName(clone.locationName),
        systemName: demoSystemName(clone.systemName),
        regionName: demoRegionName(clone.regionName),
      })),
    })),
  };
}

/** Fake corporation name, keyed by corporation id. */
function demoCorpName(corporationId: number, realName: string | null): string | null {
  if (realName === null) return null;
  const fake = assign(corpNames, `corp:${corporationId}`);
  remember(realName, fake);
  return fake;
}

export function demoBlueprintBoard(board: BlueprintBoard): BlueprintBoard {
  const holderName = (holder: BlueprintHolder): string =>
    holder.kind === 'character'
      ? demoCharacterName(holder.id, holder.name)
      : (demoCorpName(holder.id, holder.name) ?? holder.name);

  return {
    ...board,
    entries: board.entries.map((entry) => ({
      ...entry,
      holders: entry.holders.map((holder) => ({ ...holder, name: holderName(holder) })),
    })),
    characters: board.characters.map((c) => ({
      ...c,
      characterName: demoCharacterName(c.characterId, c.characterName),
    })),
    corps: board.corps.map((corp) => ({
      ...corp,
      name: demoCorpName(corp.corporationId, corp.name),
      readerCharacterName:
        corp.readerCharacterName === null
          ? null
          : demoCharacterName(corp.readerCharacterId, corp.readerCharacterName),
    })),
  };
}

export function demoCloneBoardEntry(entry: CloneBoardEntry): CloneBoardEntry {
  return {
    ...entry,
    characterName: demoCharacterName(entry.characterId, entry.characterName),
    accountLabel: demoAccountLabel(entry.accountLabel),
    clones: entry.clones.map(demoJumpClone),
    medicalClone: demoCloneLocation(entry.medicalClone),
  };
}

export function demoDashboardSummary(summary: DashboardSummary): DashboardSummary {
  return {
    ...summary,
    characters: summary.characters.map((entry) => ({
      ...entry,
      characterName: demoCharacterName(entry.characterId, entry.characterName),
    })),
  };
}

export function demoFitAnalysis(analysis: FitAnalysis): FitAnalysis {
  return {
    ...analysis,
    characters: analysis.characters.map((c) => ({
      ...c,
      characterName: demoCharacterName(c.characterId, c.characterName),
    })),
  };
}

export function demoPlanAnalysis(analysis: PlanAnalysis): PlanAnalysis {
  return {
    ...analysis,
    characters: analysis.characters.map((c) => ({
      ...c,
      characterName: demoCharacterName(c.characterId, c.characterName),
    })),
  };
}

export function demoNotification(notification: AppNotification): AppNotification {
  return {
    ...notification,
    title: demoText(notification.title),
    body: demoText(notification.body),
  };
}

export function demoSyncStatus(report: SyncStatusReport): SyncStatusReport {
  return {
    ...report,
    characters: report.characters.map((c) => ({
      ...c,
      characterName: demoCharacterName(c.characterId, c.characterName),
      accountLabel: demoAccountLabel(c.accountLabel),
    })),
  };
}

export function demoAppInfo(info: AppInfo): AppInfo {
  return {
    ...info,
    dbPath: demoPath(info.dbPath),
    userDataPath: demoPath(info.userDataPath),
  };
}

export function demoStructureResult(result: StructureSearchResult): StructureSearchResult {
  return {
    ...result,
    name: demoLocationName(result.name) ?? result.name,
    systemName: demoSystemName(result.systemName),
  };
}

export function demoSystemResult(result: SystemSearchResult): SystemSearchResult {
  return {
    ...result,
    name: demoSystemName(result.name) ?? result.name,
    regionName: demoRegionName(result.regionName),
  };
}
