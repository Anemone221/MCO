import { app, dialog, shell, type BrowserWindow } from 'electron';
import { statSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AppInfo, CharacterSyncStatus, SyncStatusReport } from '@shared/types';
import { APP_VERSION, ESI_BASE_URL, ESI_SCOPES, GITHUB_URL } from '../config';
import { getCapturedLog } from '../log';
import { formatEsiDiagnostics } from '../esi/esiLog';
import { missingScopes } from '../auth/scopeStatus';
import { grantedScopes } from '../auth/token-store';
import { getDb } from '../db';
import { listAccounts } from '../db/repositories/accounts';
import { listCharacters } from '../db/repositories/characters';
import { getCached } from '../db/repositories/esiCache';
import { getSdeStatus } from '../db/repositories/sde';
import { countStructures } from '../db/repositories/structures';
import { getInvalidTokenIds } from '../db/repositories/tokens';
import { classifyCharacterSync } from '../sync/characterSyncState';
import { getSchedulerStatus } from './scheduler';

/** Sync health of everything the app keeps fresh, for the Settings page. */
export function buildSyncStatus(): SyncStatusReport {
  const accounts = new Map(listAccounts().map((a) => [a.id, a.label]));
  const invalidTokens = getInvalidTokenIds();

  const characters: CharacterSyncStatus[] = listCharacters().map((character) => {
    const cached = getCached(`${ESI_BASE_URL}/characters/${character.id}/skills`);
    return {
      characterId: character.id,
      characterName: character.name,
      accountLabel:
        character.accountId !== null ? (accounts.get(character.accountId) ?? null) : null,
      refreshedAt: character.refreshedAt,
      nextDueAt: cached?.expiresAt ?? null,
      state: classifyCharacterSync({
        refreshedAt: character.refreshedAt,
        cacheExpiresAt: cached?.expiresAt ?? null,
        tokenInvalid: invalidTokens.has(character.id),
      }),
      missingScopes: missingScopes(grantedScopes(character.id), ESI_SCOPES),
    };
  });

  return {
    scheduler: getSchedulerStatus(),
    sde: getSdeStatus(),
    structures: countStructures(),
    characters,
    summary: {
      total: characters.length,
      ok: characters.filter((c) => c.state === 'ok').length,
      due: characters.filter((c) => c.state === 'due').length,
      neverSynced: characters.filter((c) => c.state === 'never-synced').length,
      loginExpired: characters.filter((c) => c.state === 'login-expired').length,
    },
  };
}

export function getAppInfo(): AppInfo {
  return {
    version: APP_VERSION,
    platform: `${process.platform} ${process.arch}`,
    electronVersion: process.versions.electron ?? 'unknown',
    dbPath: join(app.getPath('userData'), 'mco.sqlite'),
    userDataPath: app.getPath('userData'),
    githubUrl: GITHUB_URL,
  };
}

/** Timestamp suitable for a filename, e.g. 20260716-1432. */
function fileStamp(): string {
  const now = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}`
  );
}

/**
 * Save a diagnostics file (environment header + this session's captured log)
 * to a user-chosen location. Resolves to the path, or null when cancelled.
 */
export async function exportLogs(window: BrowserWindow | null): Promise<string | null> {
  const target = await pickSavePath(window, {
    title: 'Export MCO logs',
    defaultName: `mco-logs-${fileStamp()}.txt`,
    filters: [{ name: 'Log files', extensions: ['txt', 'log'] }],
  });
  if (!target) return null;

  const info = getAppInfo();
  let dbSize = 'unknown';
  try {
    dbSize = `${statSync(info.dbPath).size} bytes`;
  } catch {
    // DB file may not exist yet on a fresh profile
  }
  const sde = getSdeStatus();
  const header = [
    'MCO diagnostics export',
    `Generated:  ${new Date().toISOString()}`,
    `Version:    MCO ${info.version}`,
    `Runtime:    Electron ${info.electronVersion}, Chrome ${process.versions.chrome}, Node ${process.versions.node}`,
    `Platform:   ${info.platform}`,
    `User data:  ${info.userDataPath}`,
    `Database:   ${info.dbPath} (${dbSize})`,
    `Characters: ${listCharacters().length}`,
    `SDE:        ${sde.installed ? `${sde.version} (imported ${sde.importedAt})` : 'not imported'}`,
    '',
    '--- ESI activity (this run) ---',
    '',
    formatEsiDiagnostics(),
    '',
    '--- session log (oldest first; only the current run is captured) ---',
    '',
  ].join('\n');

  await writeFile(target, header + getCapturedLog() + '\n', 'utf8');
  return target;
}

/**
 * Save a consistent snapshot of the SQLite database (better-sqlite3 online
 * backup, safe under WAL) to a user-chosen location. Resolves to the path, or
 * null when cancelled. Restore = quit MCO, put the file back as mco.sqlite.
 */
export async function exportBackup(window: BrowserWindow | null): Promise<string | null> {
  const target = await pickSavePath(window, {
    title: 'Back up MCO database',
    defaultName: `mco-backup-${fileStamp()}.sqlite`,
    filters: [{ name: 'SQLite database', extensions: ['sqlite'] }],
  });
  if (!target) return null;

  await getDb().backup(target);
  console.log(`[settings] database backed up to ${target}`);
  return target;
}

/** Open the profile's data folder (mco.sqlite lives there) in the OS file manager. */
export async function openDataFolder(): Promise<void> {
  await shell.openPath(app.getPath('userData'));
}

async function pickSavePath(
  window: BrowserWindow | null,
  options: { title: string; defaultName: string; filters: Electron.FileFilter[] },
): Promise<string | null> {
  const dialogOptions = {
    title: options.title,
    defaultPath: join(app.getPath('downloads'), options.defaultName),
    filters: options.filters,
  };
  const result = window
    ? await dialog.showSaveDialog(window, dialogOptions)
    : await dialog.showSaveDialog(dialogOptions);
  return result.canceled || !result.filePath ? null : result.filePath;
}
