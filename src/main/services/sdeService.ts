import type { SdeProgress } from '@shared/types';
import type { SdeImportSummary } from '@shared/ipc';
import { downloadSde } from '../sde/downloader';
import { importSde } from '../sde/importer';
import { resolveSdeDownload } from './sdeUpdateService';

/**
 * Download the SDE zip and import it into SQLite, emitting progress throughout.
 *
 * Which build is fetched is decided here and now, from CCP's catalogue, rather
 * than by a constant compiled into this build — so "EVE added a ship" is
 * answered by clicking import, not by shipping a new MCO. Every table is
 * replaced inside the import, which is why re-importing is the upgrade path.
 */
export async function runSdeImport(
  onProgress: (progress: SdeProgress) => void,
): Promise<SdeImportSummary> {
  try {
    onProgress({ stage: 'downloading', receivedBytes: 0, totalBytes: 0 });
    const { url } = await resolveSdeDownload();
    const zipPath = await downloadSde(url, (dp) => {
      onProgress({
        stage: 'downloading',
        receivedBytes: dp.receivedBytes,
        totalBytes: dp.totalBytes,
      });
    });

    const result = await importSde(zipPath, (ip) => {
      onProgress({ stage: ip.phase, typesProcessed: ip.typesProcessed });
    });

    onProgress({ stage: 'done' });
    return result;
  } catch (err) {
    onProgress({ stage: 'error', message: String(err) });
    throw err;
  }
}
