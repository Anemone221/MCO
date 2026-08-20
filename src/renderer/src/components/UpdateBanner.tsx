import { useEffect, useState } from 'react';
import type { UpdateStatus } from '@shared/types';
import { errorMessage, mco } from '../lib/ipc';
import { useMcoData } from '../lib/useMcoData';
import { DownloadIcon } from './icons';

/**
 * Says that a newer MCO has been released, and installs it on request.
 *
 * Three things happen here, in order and only when asked: the banner announces
 * a release, **Download** fetches the installer while the bar fills, and
 * **Restart to install** applies it. Nothing downloads on its own — a profile
 * with a live database and a background sync sweep is not something to swap out
 * from under someone. A build that can't install in place (one run from source)
 * keeps only the link to the release page.
 *
 * On a profile that has never been asked, it asks first: `autoCheck` comes back
 * `unset` and the banner offers the choice instead of a release, because until
 * it is answered no check has run. That question gets the banner slot rather
 * than a modal at startup — it is the same one line in the same place, it can
 * be answered whenever, and a first launch has more urgent things on screen.
 *
 * Renders nothing unless there is genuinely something to say: a check that has
 * never run, failed, or found the running build current is silent, and so is a
 * profile that answered no. Dismissing hides one version, so the next release
 * raises the banner again.
 */
export default function UpdateBanner() {
  const { data: status, setData } = useMcoData<UpdateStatus>(() => mco.system.checkUpdate());
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  /**
   * Hides a *downloaded* update for this session only. Not the persisted
   * dismissal: the installer is already on disk and runs at the next quit
   * regardless, so recording "not this version" would be a lie.
   */
  const [hidden, setHidden] = useState(false);

  // Download progress is pushed, not polled — `setData` is a useState setter and
  // so is stable, which keeps this subscribed once for the life of the app.
  useEffect(() => mco.system.onUpdateProgress(setData), [setData]);

  if (status === null || hidden) return null;

  // Declared after the guard so it is narrowed for the closures below.
  const state = status.state;

  /** Run one of the update actions, keeping whatever status it answers with. */
  async function run(action: () => Promise<UpdateStatus>): Promise<void> {
    setBusy(true);
    setFailure(null);
    try {
      setData(await action());
    } catch (e) {
      setFailure(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  // Asked before anything is announced, because nothing has been checked yet.
  // Either button is an answer and stores one, so this is asked once per
  // profile; Settings → About holds the same switch afterwards.
  if (status.autoCheck === 'unset') {
    return (
      <div className="update-banner" data-testid="update-consent">
        <DownloadIcon size={15} />
        <div className="update-banner__text">
          Check for new MCO releases automatically? MCO would ask GitHub once a day and say so
          here — it never downloads or installs anything unless you click.
          {failure && <span className="update-banner__error"> {failure}</span>}
        </div>
        <button
          type="button"
          data-testid="update-consent-yes"
          onClick={() => void run(() => mco.system.setAutoCheckUpdate(true))}
          disabled={busy}
        >
          Check automatically
        </button>
        <button
          type="button"
          className="ghost"
          data-testid="update-consent-no"
          onClick={() => void run(() => mco.system.setAutoCheckUpdate(false))}
          disabled={busy}
        >
          No, I'll check myself
        </button>
      </div>
    );
  }

  if (status.latestVersion === null) return null;
  const version = status.latestVersion;

  if (state !== 'downloading' && state !== 'ready') {
    // `off` silences the announcement but not a download already in flight: the
    // switch governs what MCO does unasked, and those two were asked for.
    if (state !== 'update-available' || status.dismissed) return null;
    if (status.autoCheck === 'off') return null;
  }

  if (state === 'downloading') {
    const percent = status.downloadPercent ?? 0;
    return (
      <div className="update-banner" data-testid="update-banner">
        <DownloadIcon size={15} />
        <div className="update-banner__text">
          Downloading MCO {version}…
          <div
            className="update-banner__progress"
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div className="update-banner__bar" style={{ width: `${percent}%` }} />
          </div>
        </div>
        <span className="muted">{percent}%</span>
      </div>
    );
  }

  if (state === 'ready') {
    return (
      <div className="update-banner" data-testid="update-banner">
        <DownloadIcon size={15} />
        <div className="update-banner__text">
          MCO {version} is downloaded. Restarting installs it — anything in flight finishes first.
        </div>
        <button
          type="button"
          data-testid="update-install"
          onClick={() => void run(() => mco.system.installUpdate())}
          disabled={busy}
        >
          Restart to install
        </button>
        <button type="button" className="ghost" onClick={() => setHidden(true)}>
          Later
        </button>
      </div>
    );
  }

  const problem = failure ?? status.message;
  // A release GitHub titled after its own tag adds nothing the sentence has not
  // already said — it would read "MCO v0.2.1 is available … 0.2.1".
  const title =
    status.releaseName !== null &&
    status.releaseName.replace(/^v/, '') !== version.replace(/^v/, '')
      ? status.releaseName
      : null;

  return (
    <div className="update-banner" data-testid="update-banner">
      <DownloadIcon size={15} />
      <div className="update-banner__text">
        MCO {version} is available — you are running {status.currentVersion}.
        {title && <span className="muted"> {title}</span>}
        {problem && <span className="update-banner__error"> {problem}</span>}
      </div>
      <a className="update-banner__link" href={status.releaseUrl} target="_blank" rel="noreferrer">
        View release
      </a>
      {status.canInstall && (
        <button
          type="button"
          data-testid="update-download"
          onClick={() => void run(() => mco.system.downloadUpdate())}
          disabled={busy}
        >
          {busy ? 'Starting…' : 'Download'}
        </button>
      )}
      <button
        type="button"
        className="ghost"
        onClick={() => void run(() => mco.system.dismissUpdate(version))}
      >
        Dismiss
      </button>
    </div>
  );
}
