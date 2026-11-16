import { describe, expect, it } from 'vitest';
import { advance, sdeActivity, syncActivity } from '@renderer/lib/activityProgress';

describe('sdeActivity', () => {
  it('measures the download against its total', () => {
    expect(sdeActivity({ stage: 'downloading', receivedBytes: 0, totalBytes: 100 }).percent).toBe(0);
    expect(sdeActivity({ stage: 'downloading', receivedBytes: 50, totalBytes: 100 }).percent).toBe(
      12.5,
    );
    expect(sdeActivity({ stage: 'downloading', receivedBytes: 100, totalBytes: 100 }).percent).toBe(
      25,
    );
  });

  it('has no percentage while the download size is unknown', () => {
    // The first event is sent before the response arrives, with a zero total.
    expect(sdeActivity({ stage: 'downloading', receivedBytes: 0, totalBytes: 0 }).percent).toBeNull();
  });

  it('climbs through the phases in the order the zip delivers them', () => {
    // CCP's packing order, as measured — not alphabetical. Out of order, the
    // bar jumps to its highest phase and sits there while typeDogma parses.
    const percents = [
      sdeActivity({ stage: 'downloading', receivedBytes: 100, totalBytes: 100 }),
      sdeActivity({ stage: 'maps' }),
      sdeActivity({ stage: 'types', typesProcessed: 0 }),
      sdeActivity({ stage: 'types', typesProcessed: 30_000 }),
      sdeActivity({ stage: 'dogma', typesProcessed: 0 }),
      sdeActivity({ stage: 'dogma', typesProcessed: 14_000 }),
      sdeActivity({ stage: 'groups' }),
      sdeActivity({ stage: 'categories' }),
      sdeActivity({ stage: 'finalizing' }),
      sdeActivity({ stage: 'done' }),
    ].map((a) => a.percent ?? -1);

    expect(percents).toEqual([...percents].sort((a, b) => a - b));
    expect(percents[percents.length - 1]).toBe(100);
  });

  it('does not overshoot a phase when a build outgrows the estimate', () => {
    const hugeTypes = sdeActivity({ stage: 'types', typesProcessed: 10_000_000 }).percent!;
    expect(hugeTypes).toBeLessThanOrEqual(
      sdeActivity({ stage: 'dogma', typesProcessed: 0 }).percent!,
    );
    expect(sdeActivity({ stage: 'dogma', typesProcessed: 10_000_000 }).percent!).toBeLessThan(
      sdeActivity({ stage: 'finalizing' }).percent!,
    );
  });

  it('gives the long file the long stretch of the bar', () => {
    // typeDogma.yaml is ~70% of an import's running time; the bar has to keep
    // moving through it rather than spend that time parked on one number.
    const start = sdeActivity({ stage: 'dogma', typesProcessed: 0 }).percent!;
    const end = sdeActivity({ stage: 'dogma', typesProcessed: 28_000 }).percent!;
    expect(end - start).toBeGreaterThanOrEqual(50);
  });

  it('keeps short of 100 until the write has actually finished', () => {
    const saving = sdeActivity({ stage: 'finalizing' });
    expect(saving.percent).toBeLessThan(100);
    expect(saving.finished).toBe(false);
    expect(sdeActivity({ stage: 'done' }).finished).toBe(true);
  });

  it('finishes without a percentage on failure', () => {
    const failed = sdeActivity({ stage: 'error', message: 'boom' });
    expect(failed.finished).toBe(true);
    expect(failed.percent).toBeNull();
  });
});

describe('syncActivity', () => {
  it('reports the share of characters finished', () => {
    expect(syncActivity({ done: 0, total: 93 })).toMatchObject({ percent: 0, finished: false });
    const partway = syncActivity({ done: 32, total: 93 });
    expect(Math.floor(partway.percent!)).toBe(34);
    expect(partway.detail).toBe('Syncing characters: 32 of 93');
    expect(syncActivity({ done: 93, total: 93 })).toMatchObject({ percent: 100, finished: true });
  });
});

describe('advance', () => {
  const at = (percent: number | null, finished = false) => ({ percent, detail: 'x', finished });

  it('never moves backwards within a job', () => {
    // typeDogma.yaml can come out of the zip before types.yaml.
    expect(advance(at(70), at(50)).percent).toBe(70);
    expect(advance(at(50), at(70)).percent).toBe(70);
  });

  it('does not let an unknown percentage erase a known one', () => {
    expect(advance(at(30), at(null)).percent).toBe(30);
  });

  it('takes the first known percentage after an unknown one', () => {
    expect(advance(at(null), at(12)).percent).toBe(12);
  });

  it('starts a new job from scratch after a finished one', () => {
    expect(advance(at(100, true), at(0)).percent).toBe(0);
    expect(advance(null, at(5)).percent).toBe(5);
  });

  it('lets a finished state through as it is', () => {
    expect(advance(at(60), at(null, true))).toEqual(at(null, true));
  });
});
