import type { EsiActivitySummary, EsiEventKind } from '@shared/types';
import { formatDate } from '../lib/format';
import { ActivityIcon } from './icons';

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
export default function EsiActivityPanel({ activity }: { activity: EsiActivitySummary | null }) {
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
