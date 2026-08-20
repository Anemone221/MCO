import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { app } from 'electron';
import { USER_AGENT } from '../config';
import { UserFacingError } from '../errors';

export interface DownloadProgress {
  receivedBytes: number;
  totalBytes: number;
}

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
 */
export async function downloadSde(
  url: string,
  onProgress?: (progress: DownloadProgress) => void,
): Promise<string> {
  const dest = sdeZipPath();
  await mkdir(dirname(dest), { recursive: true });

  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok || !res.body) {
    throw new UserFacingError(`SDE download failed: HTTP ${res.status}`);
  }

  const totalBytes = Number(res.headers.get('content-length') ?? 0);
  let receivedBytes = 0;

  const counting = new Readable({ read() {} });
  const reader = res.body.getReader();
  void (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        receivedBytes += value.byteLength;
        onProgress?.({ receivedBytes, totalBytes });
        counting.push(Buffer.from(value));
      }
      counting.push(null);
    } catch (err) {
      counting.destroy(err as Error);
    }
  })();

  await pipeline(counting, createWriteStream(dest));
  return dest;
}
