import { join } from 'node:path';
import { app } from 'electron';
import { USER_AGENT } from '../config';
import { downloadFile, type DownloadProgress } from './downloadFile';

export type { DownloadProgress };

export function sdeZipPath(): string {
  return join(app.getPath('userData'), 'sde-cache', 'sde.zip');
}

/**
 * Download one SDE zip to the cache directory, reporting progress. Returns the
 * file path.
 *
 * The URL is passed in rather than read from config: which build to fetch is
 * decided at import time from CCP's catalogue (`services/sdeUpdateService.ts`),
 * so that a new game patch needs no new MCO.
 *
 * The transfer itself — stall timeout, length check, write-then-rename — is
 * `downloadFile`.
 */
export async function downloadSde(
  url: string,
  onProgress?: (progress: DownloadProgress) => void,
): Promise<string> {
  const dest = sdeZipPath();
  await downloadFile(url, dest, { headers: { 'User-Agent': USER_AGENT }, onProgress });
  return dest;
}
