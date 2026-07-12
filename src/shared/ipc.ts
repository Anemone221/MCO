import type {
  AccountBucket,
  CharacterDetail,
  CharacterSummary,
  Fit,
  FitAnalysis,
  LocationEntry,
  RosterEntry,
  SdeProgress,
  SdeStatus,
  SyncResult,
} from './types';

export const IpcChannel = {
  charactersRoster: 'characters:roster',
  charactersAdd: 'characters:add',
  charactersRemove: 'characters:remove',
  charactersSync: 'characters:sync',
  charactersSyncAll: 'characters:syncAll',
  charactersAssignAccount: 'characters:assignAccount',
  charactersDetail: 'characters:detail',
  charactersChanged: 'characters:changed',
  accountsList: 'accounts:list',
  accountsCreate: 'accounts:create',
  accountsRename: 'accounts:rename',
  accountsRemove: 'accounts:remove',
  sdeStatus: 'sde:status',
  sdeImport: 'sde:import',
  sdeProgress: 'sde:progress',
  fitsList: 'fits:list',
  fitsImport: 'fits:import',
  fitsRemove: 'fits:remove',
  fitsAnalyze: 'fits:analyze',
  locationBoard: 'location:board',
  systemClientConfigured: 'system:clientConfigured',
} as const;

export interface SdeImportSummary {
  version: string;
  typeCount: number;
}

/** The typed surface exposed to the renderer on `window.mco`. */
export interface McoApi {
  characters: {
    roster: () => Promise<RosterEntry[]>;
    add: () => Promise<CharacterSummary>;
    remove: (characterId: number) => Promise<void>;
    sync: (characterId: number) => Promise<void>;
    syncAll: () => Promise<SyncResult[]>;
    assignAccount: (characterId: number, accountId: number | null) => Promise<void>;
    detail: (characterId: number) => Promise<CharacterDetail>;
    /** Subscribe to background-sync updates. Returns an unsubscribe function. */
    onChanged: (callback: () => void) => () => void;
  };
  accounts: {
    list: () => Promise<AccountBucket[]>;
    create: (label: string, color?: string | null) => Promise<AccountBucket>;
    rename: (accountId: number, label: string) => Promise<void>;
    remove: (accountId: number) => Promise<void>;
  };
  sde: {
    status: () => Promise<SdeStatus>;
    import: () => Promise<SdeImportSummary>;
    onProgress: (callback: (progress: SdeProgress) => void) => () => void;
  };
  fits: {
    list: () => Promise<Fit[]>;
    import: (eftText: string) => Promise<Fit>;
    remove: (fitId: number) => Promise<void>;
    analyze: (fitId: number) => Promise<FitAnalysis>;
  };
  location: {
    board: () => Promise<LocationEntry[]>;
  };
  system: {
    isClientConfigured: () => Promise<boolean>;
  };
}
