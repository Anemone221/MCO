import { describe, expect, it } from 'vitest';
import { isQueueEntryFinished, pendingQueue } from '@main/skills/queue';

const NOW = 1_700_000_000_000;
const HOUR = 60 * 60 * 1000;

/** A queue entry as stored, identified by its ESI queue_position. */
function entry(position: number, finishOffsetMs: number | null) {
  return {
    position,
    skillTypeId: 3300 + position,
    finishLevel: 1,
    startDate: null,
    finishDate: finishOffsetMs === null ? null : new Date(NOW + finishOffsetMs).toISOString(),
  };
}

describe('isQueueEntryFinished', () => {
  it('treats a past finish date as finished', () => {
    expect(isQueueEntryFinished(entry(0, -HOUR), NOW)).toBe(true);
  });

  it('treats a finish date exactly now as finished', () => {
    expect(isQueueEntryFinished(entry(0, 0), NOW)).toBe(true);
  });

  it('does not treat a future finish date as finished', () => {
    expect(isQueueEntryFinished(entry(0, HOUR), NOW)).toBe(false);
  });

  it('does not treat a dateless (paused) entry as finished', () => {
    expect(isQueueEntryFinished(entry(0, null), NOW)).toBe(false);
  });

  it('does not treat an unparseable date as finished', () => {
    expect(isQueueEntryFinished({ finishDate: 'not a date' }, NOW)).toBe(false);
  });
});

describe('pendingQueue', () => {
  it('drops the finished entries ESI keeps returning', () => {
    // ESI leaves completed skills in the queue with their original positions.
    const queue = [
      entry(0, -5 * HOUR),
      entry(1, -3 * HOUR),
      entry(2, HOUR),
      entry(3, 4 * HOUR),
    ];
    expect(pendingQueue(queue, NOW).map((q) => q.position)).toEqual([2, 3]);
  });

  it('leaves the head as the skill actually training', () => {
    const queue = [entry(0, -HOUR), entry(1, 2 * HOUR)];
    expect(pendingQueue(queue, NOW)[0]).toEqual(queue[1]);
  });

  it('keeps every entry of a paused queue', () => {
    const queue = [entry(0, null), entry(1, null), entry(2, null)];
    expect(pendingQueue(queue, NOW)).toHaveLength(3);
  });

  it('empties a queue that has fully run out', () => {
    expect(pendingQueue([entry(0, -HOUR), entry(1, -HOUR)], NOW)).toEqual([]);
  });

  it('returns an empty queue unchanged', () => {
    expect(pendingQueue([], NOW)).toEqual([]);
  });
});
