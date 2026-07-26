import { useEffect, useState } from 'react';
import type { SdeProgress, SdeStatus } from '@shared/types';
import { mco } from '../lib/ipc';
import { formatBytes } from '../lib/format';

function progressText(progress: SdeProgress): string {
  switch (progress.stage) {
    case 'downloading': {
      const received = formatBytes(progress.receivedBytes ?? 0);
      const total = progress.totalBytes ? ` / ${formatBytes(progress.totalBytes)}` : '';
      return `Downloading SDE… ${received}${total}`;
    }
    case 'categories':
      return 'Importing categories…';
    case 'groups':
      return 'Importing groups…';
    case 'types':
      return `Importing types… ${(progress.typesProcessed ?? 0).toLocaleString()}`;
    case 'dogma':
      return `Importing skill requirements… ${(progress.typesProcessed ?? 0).toLocaleString()}`;
    case 'maps':
      return 'Importing map data…';
    case 'finalizing':
      return 'Finalizing…';
    case 'done':
      return 'Import complete.';
    case 'error':
      return `Import failed: ${progress.message ?? 'unknown error'}`;
  }
}

export default function SdeBanner() {
  const [status, setStatus] = useState<SdeStatus | null>(null);
  const [progress, setProgress] = useState<SdeProgress | null>(null);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    void mco.sde.status().then(setStatus);
    return mco.sde.onProgress(setProgress);
  }, []);

  async function runImport(): Promise<void> {
    setImporting(true);
    setProgress(null);
    try {
      await mco.sde.import();
      setStatus(await mco.sde.status());
    } catch {
      // the onProgress stream delivers the error stage for display
    } finally {
      setImporting(false);
    }
  }

  // Fully imported, including skill, map and training-attribute data — quiet
  // confirmation, no action.
  const fullyImported =
    status?.installed === true &&
    status.hasSkillData &&
    status.hasMapData &&
    status.hasSkillAttributes;
  if (fullyImported && !importing && progress?.stage !== 'error') {
    return (
      <div className="sde-banner sde-banner--ok" data-testid="sde-banner">
        Static data ready — build {status?.version}
      </div>
    );
  }

  const idleMessage =
    status?.installed && (!status.hasSkillData || !status.hasMapData || !status.hasSkillAttributes)
      ? 'Static data is incomplete — re-import to enable fit testing, training-time estimates and location names.'
      : 'Static data is not imported yet — skill, item and system names will show as IDs.';

  const buttonLabel = status?.installed ? 'Re-import static data' : 'Import static data';

  return (
    <div className="sde-banner" data-testid="sde-banner">
      <div className="sde-banner__text">
        {importing && progress ? progressText(progress) : null}
        {!importing && progress?.stage === 'error' ? progressText(progress) : null}
        {!importing && progress?.stage !== 'error' ? idleMessage : null}
      </div>
      {!importing && (
        <button type="button" onClick={() => void runImport()} data-testid="sde-import">
          {buttonLabel}
        </button>
      )}
      {importing && <div className="spinner" aria-label="importing" />}
    </div>
  );
}
