import type { SdeProgress, SyncProgress } from '@shared/types';

/**
 * Turning the two long-running jobs' progress events into the one number the
 * activity indicator shows. Pure, so the mapping is unit-tested.
 */

/** What the indicator shows: a percentage (or null while it is unknowable) and a tooltip. */
export interface Activity {
  /** 0–100, or null when there is nothing to measure against yet. */
  percent: number | null;
  /** The full sentence, for the tooltip and screen readers. */
  detail: string;
  /** The job is over; the indicator may hide. */
  finished: boolean;
}

/**
 * Where each phase sits on the bar, sized by how long it actually runs.
 *
 * Measured on build 3687575 with a fast link: download ~1 s, then ~25 s of
 * parsing, of which `types.yaml` is ~2.5 s and `typeDogma.yaml` ~17.5 s, and a
 * final write of ~1 s. The zip delivers its entries in CCP's packing order —
 * regions, types, blueprints, typeDogma, groups, categories — not in any order
 * the names suggest, and the phases below are laid out to match. That matters:
 * laid out otherwise, the bar jumps to its highest phase and sits there while
 * the long file parses, which is the "nothing is happening" this readout
 * exists to remove.
 *
 * The download keeps a real share although it was the shortest step here,
 * because on a slow link it is the longest. The write gets a visible last
 * slice so the bar does not reach 100 before the data is in.
 */
const DOWNLOAD_END = 25;
/** The small files: read in a blink wherever they fall, so one low mark covers them. */
const SMALL_FILES_EARLY = 26;
const TYPES_START = 27;
const TYPES_END = 37;
const DOGMA_START = 38;
const DOGMA_END = 90;
/** The small files that follow the long one. */
const SMALL_FILES_LATE = 91;
const WRITE_START = 94;

/**
 * Roughly how many entries the two streamed files hold. Neither carries a
 * count up front, so progress through each is measured against these; the
 * fraction is capped, so a build that outgrows one parks at the phase's end
 * rather than overshooting.
 */
const EXPECTED_TYPES = 55_000;
const EXPECTED_DOGMA_ENTRIES = 28_000;

const fraction = (processed: number | undefined, expected: number): number =>
  Math.min(1, (processed ?? 0) / expected);

/**
 * Overall progress of a static-data import. The zip's entry order is CCP's to
 * change, so consecutive events are not guaranteed to climb — the caller keeps
 * the highest value it has seen (see {@link advance}).
 */
export function sdeActivity(progress: SdeProgress): Activity {
  const running = (percent: number | null, what: string): Activity => ({
    percent,
    detail: `Static data import: ${what}`,
    finished: false,
  });

  switch (progress.stage) {
    case 'downloading': {
      const total = progress.totalBytes ?? 0;
      if (total <= 0) return running(null, 'downloading');
      const share = Math.min(1, (progress.receivedBytes ?? 0) / total);
      return running(share * DOWNLOAD_END, 'downloading');
    }
    case 'categories':
      return running(SMALL_FILES_LATE, 'reading categories');
    case 'groups':
      return running(SMALL_FILES_LATE, 'reading groups');
    case 'types':
      return running(
        TYPES_START +
          fraction(progress.typesProcessed, EXPECTED_TYPES) * (TYPES_END - TYPES_START),
        'reading types',
      );
    case 'dogma':
      return running(
        DOGMA_START +
          fraction(progress.typesProcessed, EXPECTED_DOGMA_ENTRIES) * (DOGMA_END - DOGMA_START),
        'reading skill requirements',
      );
    case 'blueprints':
      return running(SMALL_FILES_EARLY, 'reading blueprints');
    case 'maps':
      return running(SMALL_FILES_EARLY, 'reading the map');
    case 'finalizing':
      return running(WRITE_START, 'saving');
    case 'done':
      return { percent: 100, detail: 'Static data import complete', finished: true };
    case 'error':
      // The SDE banner carries the message; the indicator just gets out of the way.
      return { percent: null, detail: 'Static data import failed', finished: true };
  }
}

/** Progress of a multi-character sync. */
export function syncActivity(progress: SyncProgress): Activity {
  const finished = progress.done >= progress.total;
  return {
    percent: progress.total > 0 ? (progress.done / progress.total) * 100 : 100,
    detail: `Syncing characters: ${progress.done} of ${progress.total}`,
    finished,
  };
}

/**
 * The next state to show, given the one on screen: within one job the
 * percentage never moves backwards, and an unknown percentage does not erase a
 * known one. A finished activity always replaces what is there.
 */
export function advance(previous: Activity | null, next: Activity): Activity {
  if (next.finished || previous === null || previous.finished) return next;
  if (previous.percent === null) return next;
  return { ...next, percent: Math.max(previous.percent, next.percent ?? 0) };
}
