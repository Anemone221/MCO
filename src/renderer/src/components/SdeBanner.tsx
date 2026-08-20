import { useEffect, useState } from 'react';
import type { SdeProgress, SdeStatus, SdeUpdateStatus } from '@shared/types';
import { mco } from '../lib/ipc';
import { formatBytes, formatDate } from '../lib/format';

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
    case 'blueprints':
      return 'Importing blueprints…';
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

/**
 * How often the banner re-asks whether a newer build exists.
 *
 * MCO is built to sit in the tray for days, and this banner mounts once per
 * launch — without a timer, "CCP patched yesterday" would need a restart to
 * reach anyone. The main process caches the answer for a day, so every call but
 * the first of each day costs nothing.
 */
const RECHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export default function SdeBanner() {
  const [status, setStatus] = useState<SdeStatus | null>(null);
  const [update, setUpdate] = useState<SdeUpdateStatus | null>(null);
  const [progress, setProgress] = useState<SdeProgress | null>(null);
  const [importing, setImporting] = useState(false);

  /**
   * Asked separately from `status`, and allowed to fail quietly: the check may
   * go out to CCP's catalogue, and whether static data is *imported* must
   * render without waiting on a network round trip. The main side never
   * rejects, so the failure arm only covers IPC itself — which leaves the last
   * answer standing rather than replacing it with a wrong one.
   */
  function refreshUpdate(): void {
    void mco.sde.checkUpdate().then(setUpdate, () => undefined);
  }

  useEffect(() => {
    void mco.sde.status().then(setStatus);
    refreshUpdate();
    const timer = setInterval(refreshUpdate, RECHECK_INTERVAL_MS);
    const unsubscribe = mco.sde.onProgress(setProgress);
    return () => {
      clearInterval(timer);
      unsubscribe();
    };
  }, []);

  async function runImport(): Promise<void> {
    setImporting(true);
    setProgress(null);
    try {
      await mco.sde.import();
      setStatus(await mco.sde.status());
      // The import just fetched the newest build, so this reads back as "up to
      // date" — cached, no second round trip.
      setUpdate(await mco.sde.checkUpdate());
    } catch {
      // the onProgress stream delivers the error stage for display
    } finally {
      setImporting(false);
    }
  }

  // Fully imported, including skill, map, stargate, training-attribute and
  // blueprint data — quiet confirmation, no action.
  const fullyImported =
    status?.installed === true &&
    status.hasSkillData &&
    status.hasMapData &&
    status.hasJumpData &&
    status.hasSkillAttributes &&
    status.hasBlueprintData;
  if (fullyImported && !importing && progress?.stage !== 'error') {
    // EVE patches in ships, skills and blueprints between MCO releases; CCP
    // publishes a new SDE build for each. Say so, because the imported data is
    // otherwise silently missing them and nothing else would ever mention it.
    if (update !== null && update.updateAvailable && !update.dismissed) {
      const build = update.latestBuild ?? '';
      return (
        <div className="sde-banner sde-banner--update" data-testid="sde-banner">
          <div className="sde-banner__text">
            Static data build {build} is available — you imported {update.installedBuild}. Re-import
            to pick up skills, ships and blueprints added since.
            {update.releasedAt !== null && (
              <span className="muted"> Released {formatDate(update.releasedAt)}.</span>
            )}
          </div>
          <button type="button" onClick={() => void runImport()} data-testid="sde-import">
            Update static data
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => void mco.sde.dismissUpdate(build).then(setUpdate)}
          >
            Dismiss
          </button>
        </div>
      );
    }

    return (
      <div className="sde-banner sde-banner--ok" data-testid="sde-banner">
        Static data ready — build {status?.version}
      </div>
    );
  }

  const idleMessage =
    status?.installed &&
    (!status.hasSkillData ||
      !status.hasMapData ||
      !status.hasJumpData ||
      !status.hasSkillAttributes ||
      !status.hasBlueprintData)
      ? 'Static data is incomplete — re-import to enable fit testing, training-time estimates, location names, jump distances and the blueprint checklist.'
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
