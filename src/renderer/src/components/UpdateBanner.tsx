import type { UpdateStatus } from '@shared/types';
import { mco } from '../lib/ipc';
import { useMcoData } from '../lib/useMcoData';
import { DownloadIcon } from './icons';

/**
 * Says that a newer MCO has been released, and links to it. Nothing is
 * downloaded or installed — MCO is updated by reinstalling from GitHub.
 *
 * Renders nothing unless there is genuinely something newer: a check that has
 * never run, failed, or found the running build current is silent. Dismissing
 * hides one version, so the next release raises the banner again.
 */
export default function UpdateBanner() {
  const { data: status, setData } = useMcoData<UpdateStatus>(() => mco.system.checkUpdate());

  if (
    status === null ||
    status.state !== 'update-available' ||
    status.dismissed ||
    status.latestVersion === null
  ) {
    return null;
  }
  // Declared after the guard so it is a `string`, which the dismiss closure needs.
  const version = status.latestVersion;

  async function dismiss(): Promise<void> {
    setData(await mco.system.dismissUpdate(version));
  }

  return (
    <div className="update-banner" data-testid="update-banner">
      <DownloadIcon size={15} />
      <div className="update-banner__text">
        MCO {version} is available — you are running {status.currentVersion}.
        {status.releaseName && <span className="muted"> {status.releaseName}</span>}
      </div>
      <a className="update-banner__link" href={status.releaseUrl} target="_blank" rel="noreferrer">
        View release
      </a>
      <button type="button" className="ghost" onClick={() => void dismiss()}>
        Dismiss
      </button>
    </div>
  );
}
