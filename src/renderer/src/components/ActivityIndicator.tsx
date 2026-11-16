import { useEffect, useRef, useState } from 'react';
import { mco } from '../lib/ipc';
import { advance, sdeActivity, syncActivity, type Activity } from '../lib/activityProgress';

/** How long a finished job's 100% stays up before the indicator goes away. */
const LINGER_MS = 1500;

type Job = 'sde' | 'sync';

/**
 * A small progress readout pinned to the bottom of the window while one of the
 * two long jobs is running: a static-data import, or a multi-character sync
 * ("Sync all" and the background sweep alike).
 *
 * Both used to be all but silent — a banner line on one page, a button reading
 * "Syncing…" on another — so from anywhere else in the app nothing appeared to
 * be happening for minutes. This sits outside the routes, so it shows whatever
 * page is open. It renders nothing while idle.
 *
 * Each job keeps its own state; when both run, the import is the one shown,
 * being the one the user is waiting on.
 */
export default function ActivityIndicator() {
  const [jobs, setJobs] = useState<Partial<Record<Job, Activity>>>({});
  const timers = useRef<Partial<Record<Job, ReturnType<typeof setTimeout>>>>({});

  useEffect(() => {
    const pending = timers.current;

    function report(job: Job, next: Activity): void {
      clearTimeout(pending[job]);
      setJobs((prev) => ({ ...prev, [job]: advance(prev[job] ?? null, next) }));
      if (next.finished) {
        pending[job] = setTimeout(() => {
          setJobs((prev) => {
            const rest = { ...prev };
            delete rest[job];
            return rest;
          });
        }, LINGER_MS);
      }
    }

    const offSde = mco.sde.onProgress((p) => report('sde', sdeActivity(p)));
    const offSync = mco.characters.onSyncProgress((p) => report('sync', syncActivity(p)));
    return () => {
      offSde();
      offSync();
      for (const timer of Object.values(pending)) clearTimeout(timer);
    };
  }, []);

  const activity = jobs.sde ?? jobs.sync;
  if (!activity) return null;

  const percent = activity.percent === null ? null : Math.floor(activity.percent);
  return (
    <div
      className="activity-indicator"
      role="progressbar"
      aria-label={activity.detail}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent ?? undefined}
      title={activity.detail}
      data-testid="activity-indicator"
    >
      <span className="activity-indicator__track">
        <span
          className={
            percent === null
              ? 'activity-indicator__fill activity-indicator__fill--unknown'
              : 'activity-indicator__fill'
          }
          style={percent === null ? undefined : { width: `${percent}%` }}
        />
      </span>
      <span className="activity-indicator__label">{percent === null ? '…' : `${percent}%`}</span>
    </div>
  );
}
