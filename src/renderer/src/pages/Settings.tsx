import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type {
  AppInfo,
  CharacterSyncState,
  EsiActivitySummary,
  EsiEventKind,
  SyncStatusReport,
} from '@shared/types';
import { mco } from '../lib/ipc';
import { isDemoMode, setDemoMode } from '../lib/demo';
import { formatDate } from '../lib/format';
import { THEMES, type ThemeId } from '../lib/theme';
import { applyTheme, getStoredTheme } from '../theme';
import StatusSquare from '../components/StatusSquare';
import {
  ActivityIcon,
  ChevronIcon,
  DatabaseIcon,
  EyeOffIcon,
  FileTextIcon,
  GithubIcon,
  InfoIcon,
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

const EVENT_KIND_LABEL: Record<EsiEventKind, string> = {
  throttle: 'Throttled',
  retry: '5xx retry',
  timeout: 'Timeout',
  'network-error': 'Network error',
  'auth-refresh': 'Token refresh',
  'give-up': 'Gave up',
  backoff: 'Backoff',
  slow: 'Slow',
  sweep: 'Sweep',
};

/**
 * At-a-glance ESI request health for this app run. Throttles/timeouts/give-ups
 * are the numbers that matter when the sync is misbehaving; the full event
 * history rides along in the "Export logs" diagnostics file.
 */
function EsiActivityPanel({ activity }: { activity: EsiActivitySummary | null }) {
  if (!activity) return null;
  const s = activity.status;
  const throttles = s.throttled420 + s.throttled429;
  const failures = activity.timeouts + activity.networkErrors + activity.giveUps;
  const recent = [...activity.recentEvents].reverse().slice(0, 8);

  return (
    <div className="settings-section">
      <h3>
        <ActivityIcon size={15} />
        ESI activity
      </h3>
      <p className="muted">
        Live counters for this app run — how MCO's calls to EVE's servers are faring. Throttles,
        timeouts and give-ups above zero are worth a look; “Export logs” below carries the full
        event history for a bug report.
      </p>
      <div className="settings-facts" data-testid="esi-activity-facts">
        <div>
          <span className="muted">Requests</span>
          {activity.requests.toLocaleString()} network · {activity.cacheFresh.toLocaleString()} from
          cache
        </div>
        <div>
          <span className="muted">Statuses</span>
          200 {s.ok200} · 304 {s.notModified304} · 401→refresh {s.unauthorized401} · 5xx{' '}
          {s.serverError5xx} · other 4xx {s.otherError}
        </div>
        <div>
          <span className="muted">Throttling</span>
          {throttles > 0 ? (
            <span className="chip chip--danger">
              420 {s.throttled420} · 429 {s.throttled429}
            </span>
          ) : (
            'none'
          )}
        </div>
        <div>
          <span className="muted">Failures</span>
          {failures > 0 ? (
            <span className="chip chip--danger">
              timeouts {activity.timeouts} · network {activity.networkErrors} · give-ups{' '}
              {activity.giveUps}
            </span>
          ) : (
            `none · ${activity.slowRequests} slow`
          )}
        </div>
        <div>
          <span className="muted">Backoff</span>
          {activity.backoffWindows} window(s) · {activity.totalBackoffSeconds}s total · longest{' '}
          {activity.maxBackoffSeconds}s
          {activity.currentBackoffSeconds > 0 && (
            <span className="chip chip--fatigue">paused ~{activity.currentBackoffSeconds}s</span>
          )}
        </div>
      </div>
      {recent.length > 0 && (
        <table className="data-table" data-testid="esi-events-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Event</th>
              <th>Route</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {recent.map((e, i) => (
              <tr key={`${e.at}-${i}`}>
                <td>{formatDate(e.at)}</td>
                <td>{EVENT_KIND_LABEL[e.kind]}</td>
                <td>
                  {e.path ?? '—'}
                  {e.status ? ` (${e.status})` : ''}
                </td>
                <td className="muted">
                  {[
                    e.backoffSeconds ? `backoff ${e.backoffSeconds}s` : null,
                    e.ms ? `${e.ms}ms` : null,
                    e.detail ?? null,
                  ]
                    .filter(Boolean)
                    .join(' · ') || '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default function Settings() {
  const [status, setStatus] = useState<SyncStatusReport | null>(null);
  const [esi, setEsi] = useState<EsiActivitySummary | null>(null);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncCollapsed, setSyncCollapsed] = useState(loadSyncCollapsed);
  const [theme, setTheme] = useState<ThemeId>(getStoredTheme());
  const [demo, setDemo] = useState(isDemoMode());
  const [logStatus, setLogStatus] = useState<string | null>(null);
  const [backupStatus, setBackupStatus] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, a, i] = await Promise.all([
        mco.settings.syncStatus(),
        mco.settings.esiActivity(),
        mco.system.appInfo(),
      ]);
      setStatus(s);
      setEsi(a);
      setInfo(i);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    return mco.characters.onChanged(() => void load());
  }, [load]);

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
    void load();
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
      const failed = results.filter((r) => !r.ok).length;
      if (failed > 0) setError(`${failed} of ${results.length} character sync(s) failed`);
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setSyncing(false);
    }
  }

  async function onExportLogs(): Promise<void> {
    setLogStatus(null);
    try {
      const path = await mco.settings.exportLogs();
      setLogStatus(path ? `Saved to ${path}` : null);
    } catch (e) {
      setLogStatus(String(e));
    }
  }

  async function onExportBackup(): Promise<void> {
    setBackupStatus(null);
    try {
      const path = await mco.settings.exportBackup();
      setBackupStatus(path ? `Saved to ${path}` : null);
    } catch (e) {
      setBackupStatus(String(e));
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
        <button type="button" className="ghost" onClick={() => void load()} disabled={loading}>
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
            MCO {info.version} · Electron {info.electronVersion} · {info.platform}
          </p>
        )}
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
      </div>
    </section>
  );
}
