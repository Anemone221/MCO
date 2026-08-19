import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { BackgroundModeSettings, CharacterSyncState, UpdateStatus } from '@shared/types';
import { errorMessage, mco } from '../lib/ipc';
import { useMcoData } from '../lib/useMcoData';
import { isDemoMode, setDemoMode } from '../lib/demo';
import { formatDate } from '../lib/format';
import { THEMES, type ThemeId } from '../lib/theme';
import { applyTheme, getStoredTheme } from '../theme';
import StatusSquare from '../components/StatusSquare';
import EsiActivityPanel from '../components/EsiActivityPanel';
import {
  ChevronIcon,
  DatabaseIcon,
  DownloadIcon,
  EyeOffIcon,
  FileTextIcon,
  GithubIcon,
  InfoIcon,
  MinimizeIcon,
  PaletteIcon,
  RefreshIcon,
} from '../components/icons';

const SYNC_COLLAPSED_KEY = 'mco-settings-sync-collapsed';

function loadSyncCollapsed(): boolean {
  try {
    return localStorage.getItem(SYNC_COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

function storeSyncCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(SYNC_COLLAPSED_KEY, collapsed ? '1' : '0');
  } catch {
    // storage unavailable — the toggle still works for this session
  }
}

const STATE_LABEL: Record<CharacterSyncState, string> = {
  ok: 'Fresh',
  due: 'Due',
  'never-synced': 'Never synced',
  'login-expired': 'Login expired',
};

/** Fresh and due are both routine (sync is cache-driven); only auth problems alarm. */
const STATE_CHIP: Record<CharacterSyncState, string> = {
  ok: 'chip chip--ok',
  due: 'chip chip--idle',
  'never-synced': 'chip chip--idle',
  'login-expired': 'chip chip--danger',
};

const STATE_ORDER: Record<CharacterSyncState, number> = {
  'login-expired': 0,
  'never-synced': 1,
  due: 2,
  ok: 3,
};

function SyncStateChip({ state }: { state: CharacterSyncState }) {
  return <span className={STATE_CHIP[state]}>{STATE_LABEL[state]}</span>;
}

/**
 * One line on what the last release check found, or on the download it started.
 * `unknown` states say why they have no answer — a never-run check, a network
 * failure, a repository with no releases yet — rather than implying the build is
 * current.
 *
 * Installing happens from the banner, not here: this is the About section, and
 * a "Restart now" button several screens deep from where the update was
 * announced is a button people press by accident.
 */
function UpdateSummary({ status }: { status: UpdateStatus }) {
  if (status.state === 'downloading') {
    return (
      <span className="muted">
        Downloading MCO {status.latestVersion}… {status.downloadPercent ?? 0}%
      </span>
    );
  }

  if (status.state === 'ready') {
    return (
      <span className="muted">
        MCO {status.latestVersion} is downloaded — restart to install it.
      </span>
    );
  }

  if (status.message !== null) return <span className="muted">{status.message}</span>;

  if (status.state === 'update-available') {
    return (
      <a className="settings-link" href={status.releaseUrl} target="_blank" rel="noreferrer">
        <DownloadIcon size={15} />
        MCO {status.latestVersion} is available
      </a>
    );
  }

  // No answer yet, and no message explaining why — say so rather than let
  // silence read as confirmation that the build is current.
  if (status.state === 'unknown') return <span className="muted">Not checked yet.</span>;

  return (
    <span className="muted">
      Up to date{status.checkedAt && ` · checked ${formatDate(status.checkedAt)}`}
    </span>
  );
}

export default function Settings() {
  const [syncing, setSyncing] = useState(false);
  const [syncCollapsed, setSyncCollapsed] = useState(loadSyncCollapsed);
  const [theme, setTheme] = useState<ThemeId>(getStoredTheme());
  const [demo, setDemo] = useState(isDemoMode());
  const [logStatus, setLogStatus] = useState<string | null>(null);
  const [backupStatus, setBackupStatus] = useState<string | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);

  const { data, error, loading, reload, setData, setError } = useMcoData(
    async () => {
      const [status, esi, info, background] = await Promise.all([
        mco.settings.syncStatus(),
        mco.settings.esiActivity(),
        mco.system.appInfo(),
        mco.settings.backgroundMode(),
      ]);
      return { status, esi, info, background };
    },
    { onCharactersChanged: true },
  );
  const { status = null, esi = null, info = null, background = null } = data ?? {};

  // Loaded separately: the release check may go out to GitHub, and the rest of
  // the page must not wait behind a network round trip to render.
  const { data: update, setData: setUpdate } = useMcoData<UpdateStatus>(() =>
    mco.system.checkUpdate(),
  );

  /** "Check for updates" — ignores the daily interval and asks GitHub now. */
  async function checkForUpdate(): Promise<void> {
    setCheckingUpdate(true);
    try {
      setUpdate(await mco.system.checkUpdate(true));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setCheckingUpdate(false);
    }
  }

  /** Apply a background-mode change without re-fetching the rest of the page. */
  function applyBackground(next: BackgroundModeSettings): void {
    setData((prev) => (prev ? { ...prev, background: next } : prev));
  }

  function selectTheme(next: ThemeId): void {
    applyTheme(next);
    setTheme(next);
  }

  function toggleDemo(): void {
    const next = !demo;
    setDemoMode(next);
    setDemo(next);
    // Re-fetch so the sync table above follows the toggle immediately; other
    // pages pick it up when they mount (every page loads its data on mount).
    void reload();
  }

  function toggleSyncCollapsed(): void {
    setSyncCollapsed((prev) => {
      storeSyncCollapsed(!prev);
      return !prev;
    });
  }

  async function syncAllNow(): Promise<void> {
    setSyncing(true);
    try {
      const results = await mco.characters.syncAll();
      // Reload first: it clears the error box, so the partial-failure count
      // has to be written after it or it would never reach the screen.
      await reload();
      const failed = results.filter((r) => !r.ok).length;
      if (failed > 0) setError(`${failed} of ${results.length} character sync(s) failed`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSyncing(false);
    }
  }

  async function toggleCloseToTray(): Promise<void> {
    if (!background) return;
    try {
      applyBackground(await mco.settings.setCloseToTray(!background.closeToTray));
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function runInBackground(): Promise<void> {
    try {
      applyBackground(await mco.settings.runInBackground());
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function onExportLogs(): Promise<void> {
    setLogStatus(null);
    try {
      const path = await mco.settings.exportLogs();
      setLogStatus(path ? `Saved to ${path}` : null);
    } catch (e) {
      setLogStatus(errorMessage(e));
    }
  }

  async function onExportBackup(): Promise<void> {
    setBackupStatus(null);
    try {
      const path = await mco.settings.exportBackup();
      setBackupStatus(path ? `Saved to ${path}` : null);
    } catch (e) {
      setBackupStatus(errorMessage(e));
    }
  }

  const characters = status
    ? [...status.characters].sort(
        (a, b) =>
          STATE_ORDER[a.state] - STATE_ORDER[b.state] ||
          a.characterName.localeCompare(b.characterName),
      )
    : [];

  return (
    <section className="page" data-testid="settings-page">
      <div className="toolbar">
        <h2>Settings</h2>
        <button type="button" className="ghost" onClick={() => void reload()} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {error && <div className="error-box">{error}</div>}

      <div className="settings-section">
        <div className="settings-section__header">
          <button
            type="button"
            className="collapse-toggle"
            aria-expanded={!syncCollapsed}
            title={syncCollapsed ? 'Expand' : 'Collapse'}
            onClick={toggleSyncCollapsed}
            data-testid="sync-status-toggle"
          >
            <ChevronIcon open={!syncCollapsed} size={14} />
          </button>
          <h3>
            <RefreshIcon size={15} />
            Sync status
          </h3>
          {status && (
            <div className="status-squares status-squares--compact">
              <StatusSquare
                title="Fresh"
                tone={
                  status.summary.total > 0 && status.summary.ok === status.summary.total
                    ? 'ok'
                    : 'idle'
                }
                label={`${status.summary.ok}/${status.summary.total}`}
                testId="square-sync-fresh"
              />
              <StatusSquare
                title="Due"
                tone="idle"
                label={String(status.summary.due + status.summary.neverSynced)}
                testId="square-sync-due"
              />
              <StatusSquare
                title="Logins"
                tone={status.summary.loginExpired > 0 ? 'danger' : 'ok'}
                label={
                  status.summary.loginExpired > 0
                    ? `${status.summary.loginExpired} expired`
                    : 'OK'
                }
                testId="square-sync-logins"
              />
            </div>
          )}
          <button
            type="button"
            className="btn-sm settings-section__header-action"
            onClick={() => void syncAllNow()}
            disabled={syncing}
            data-testid="settings-sync-all"
          >
            {syncing ? 'Syncing…' : 'Sync all now'}
          </button>
        </div>

        {status && !syncCollapsed && (
          <div className="settings-section__body" data-testid="sync-status-body">
            <div className="settings-facts">
              <div>
                <span className="muted">Background sync</span>
                {status.scheduler.running
                  ? `hourly · last sweep ${formatDate(status.scheduler.lastSweepAt)} · next ${formatDate(status.scheduler.nextSweepAt)}`
                  : 'not running'}
              </div>
              <div>
                <span className="muted">SDE</span>
                {status.sde.installed
                  ? `${status.sde.version ?? 'unknown build'} · imported ${formatDate(status.sde.importedAt)}`
                  : 'not imported'}
              </div>
              <div>
                <span className="muted">Structures</span>
                {status.structures.total === 0
                  ? 'none imported'
                  : `${status.structures.resolved} of ${status.structures.total} named`}
              </div>
            </div>

            {characters.length === 0 ? (
              <p className="muted">No characters yet.</p>
            ) : (
              <table className="data-table" data-testid="settings-sync-table">
                <thead>
                  <tr>
                    <th>Character</th>
                    <th>Account</th>
                    <th>Last synced</th>
                    <th>Next due</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {characters.map((c) => (
                    <tr key={c.characterId}>
                      <td>
                        <Link to={`/character/${c.characterId}`}>{c.characterName}</Link>
                      </td>
                      <td>{c.accountLabel ?? '—'}</td>
                      <td>{formatDate(c.refreshedAt)}</td>
                      <td>{c.state === 'ok' ? formatDate(c.nextDueAt) : '—'}</td>
                      <td>
                        <SyncStateChip state={c.state} />
                        {c.missingScopes.length > 0 && c.state !== 'login-expired' && (
                          <span
                            className="muted settings-scope-note"
                            title={c.missingScopes.join('\n')}
                          >
                            {c.missingScopes.length} scope(s) missing
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      <div className="settings-section">
        <h3>
          <MinimizeIcon size={15} />
          Background sync
        </h3>
        <p className="muted">
          The hourly sweep runs whenever MCO is running. Keep MCO in the notification area to
          carry on syncing — and raising skill-queue warnings — with the window closed. Reopen
          or quit it from the tray icon; there is still only one MCO per profile either way.
        </p>
        <label className="muted">
          <input
            type="checkbox"
            checked={background?.closeToTray ?? false}
            disabled={!background || background.launchedInBackground}
            onChange={() => void toggleCloseToTray()}
            data-testid="close-to-tray-toggle"
          />{' '}
          Keep syncing in the tray when I close the window
        </label>
        <div className="settings-actions">
          <button
            type="button"
            className="ghost"
            onClick={() => void runInBackground()}
            data-testid="settings-run-in-background"
          >
            Run in background now
          </button>
          {background?.launchedInBackground && (
            <span className="muted">
              Started in background mode — this MCO always lives in the tray.
            </span>
          )}
          {/* Only after tray mode was actually asked for: trayActive is false
              by design whenever the option is off. */}
          {background?.closeToTray && !background.trayActive && (
            <span className="muted" data-testid="tray-unavailable">
              No notification area available on this desktop — MCO will stay in a window.
            </span>
          )}
        </div>
      </div>

      <div className="settings-section">
        <h3>
          <PaletteIcon size={15} />
          Appearance
        </h3>
        <div className="theme-picker" data-testid="theme-picker">
          {THEMES.map((t) => (
            <label
              key={t.id}
              className={theme === t.id ? 'theme-option theme-option--active' : 'theme-option'}
            >
              <input
                type="radio"
                name="theme"
                value={t.id}
                checked={theme === t.id}
                onChange={() => selectTheme(t.id)}
              />
              <span className={`theme-swatch theme-swatch--${t.id}`} aria-hidden="true" />
              <span>
                <strong>{t.label}</strong>
                <span className="muted theme-option__desc">{t.description}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      <div className="settings-section">
        <h3>
          <EyeOffIcon size={15} />
          Demo mode
        </h3>
        <p className="muted">
          Replaces character, account and location names with made-up ones and hides portraits, so
          you can take screenshots without exposing your roster. Display-only — nothing in the
          database changes. Already-open pages update when you next visit them.
        </p>
        <label className="muted">
          <input
            type="checkbox"
            checked={demo}
            onChange={toggleDemo}
            data-testid="demo-mode-toggle"
          />{' '}
          Randomize names and locations
        </label>
      </div>

      <EsiActivityPanel activity={esi} />

      <div className="settings-section">
        <h3>
          <FileTextIcon size={15} />
          Logs
        </h3>
        <p className="muted">
          If something looks wrong, export a diagnostics file (app info plus this session's
          activity log) and attach it to a bug report.
        </p>
        <div className="settings-actions">
          <button type="button" className="ghost" onClick={() => void onExportLogs()}>
            Export logs…
          </button>
          {logStatus && <span className="muted">{logStatus}</span>}
        </div>
      </div>

      <div className="settings-section">
        <h3>
          <DatabaseIcon size={15} />
          Backup
        </h3>
        <p className="muted">
          Saves a snapshot of the database — characters, accounts, groups, tags, fits, plans and
          imported SDE data. To restore after a reinstall: quit MCO, copy the backup over{' '}
          <code>{info?.dbPath ?? 'mco.sqlite'}</code>, and start MCO again. Character logins are
          encrypted for this OS user, so on a new machine you will need to re-add characters
          (everything else survives).
        </p>
        <div className="settings-actions">
          <button type="button" className="ghost" onClick={() => void onExportBackup()}>
            Back up database…
          </button>
          <button type="button" className="ghost" onClick={() => void mco.settings.openDataFolder()}>
            Open data folder
          </button>
          {backupStatus && <span className="muted">{backupStatus}</span>}
        </div>
      </div>

      <div className="settings-section">
        <h3>
          <InfoIcon size={15} />
          About
        </h3>
        {info && (
          <p className="muted">
            MCO {info.version} · Electron {info.electronVersion} · {info.platform} · schema v
            {info.schemaVersion}
          </p>
        )}
        <div className="settings-actions">
          <button
            type="button"
            className="ghost"
            onClick={() => void checkForUpdate()}
            disabled={checkingUpdate}
          >
            {checkingUpdate ? 'Checking…' : 'Check for updates'}
          </button>
          {update && <UpdateSummary status={update} />}
        </div>
        <div className="settings-actions">
          <a
            className="settings-link"
            href={info?.githubUrl ?? 'https://github.com/Anemone221/MCO'}
            target="_blank"
            rel="noreferrer"
          >
            <GithubIcon size={15} />
            GitHub repository
          </a>
          <a
            className="settings-link"
            href={`${info?.githubUrl ?? 'https://github.com/Anemone221/MCO'}/issues`}
            target="_blank"
            rel="noreferrer"
          >
            <GithubIcon size={15} />
            Report an issue
          </a>
        </div>
        {/*
          CCP's standard third-party notice, required of applications built on
          the EVE Developer License Agreement. Wording is CCP's — adapt the tool
          name, not the sentences. Keep this in step with README.md § Legal.
        */}
        <p className="legal-notice">
          EVE Online, the EVE logo, EVE and all associated logos and designs are the
          intellectual property of CCP hf. All artwork, screenshots, characters, vehicles,
          storylines, world facts or other recognizable features of the intellectual property
          relating to these trademarks are likewise the intellectual property of CCP hf. EVE
          Online and the EVE logo are the registered trademarks of CCP hf. All rights are
          reserved worldwide. All other trademarks are the property of their respective owners.
          CCP hf. has granted permission to MCO to use EVE Online and all associated logos and
          designs for promotional and information purposes but does not endorse, and is not in
          any way affiliated with, MCO. CCP is in no way responsible for the content on or
          functioning of this program, nor can it be liable for any damage arising from the use
          of this program.
        </p>
      </div>
    </section>
  );
}
