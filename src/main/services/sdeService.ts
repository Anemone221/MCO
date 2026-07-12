import type { SdeProgress } from '@shared/types';
import type { SdeImportSummary } from '@shared/ipc';
import { downloadSde } from '../sde/downloader';
import { importSde } from '../sde/importer';

/** Download the SDE zip and import it into SQLite, emitting progress throughout. */
export async function runSdeImport(
  onProgress: (progress: SdeProgress) => void,
): Promise<SdeImportSummary> {
  try {
    onProgress({ stage: 'downloading', receivedBytes: 0, totalBytes: 0 });
    const zipPath = await downloadSde((dp) => {
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
