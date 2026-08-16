import { describe, expect, it } from 'vitest';
import { createSingleFlight } from '@main/auth/singleFlight';

/** A promise plus the handles to settle it from the test. */
function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (err: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('createSingleFlight', () => {
  it('runs the task once for concurrent callers on the same key', async () => {
    const flight = createSingleFlight<number, string>();
    const gate = deferred<string>();
    let runs = 0;

    const task = (): Promise<string> => {
      runs += 1;
      return gate.promise;
    };
    const first = flight.run(90_000_001, task);
    const second = flight.run(90_000_001, task);

    gate.resolve('token-a');
    await expect(first).resolves.toBe('token-a');
    await expect(second).resolves.toBe('token-a');
    expect(runs).toBe(1);
  });

  it('keeps different keys independent', async () => {
    const flight = createSingleFlight<number, string>();
    const seen: number[] = [];

    const [a, b] = await Promise.all([
      flight.run(1, async () => {
        seen.push(1);
        return 'a';
      }),
      flight.run(2, async () => {
        seen.push(2);
        return 'b';
      }),
    ]);

    expect([a, b]).toEqual(['a', 'b']);
    expect(seen.sort()).toEqual([1, 2]);
  });

  it('starts fresh work once the previous run has settled', async () => {
    const flight = createSingleFlight<string, number>();
    let runs = 0;
    const task = async (): Promise<number> => {
      runs += 1;
      return runs;
    };

    await expect(flight.run('k', task)).resolves.toBe(1);
    await expect(flight.run('k', task)).resolves.toBe(2);
    expect(runs).toBe(2);
  });

  it('propagates a failure to every joined caller and clears the key', async () => {
    const flight = createSingleFlight<string, number>();
    const gate = deferred<number>();

    const first = flight.run('k', () => gate.promise);
    const second = flight.run('k', () => gate.promise);
    gate.reject(new Error('SSO said no'));

    await expect(first).rejects.toThrow('SSO said no');
    await expect(second).rejects.toThrow('SSO said no');
    expect(flight.size).toBe(0);

    // A failed exchange must not poison the key — the next sweep may well succeed.
    await expect(flight.run('k', async () => 7)).resolves.toBe(7);
  });

  it('releases the key when the task throws synchronously', async () => {
    const flight = createSingleFlight<string, number>();
    await expect(
      flight.run('k', () => {
        throw new Error('bad call');
      }),
    ).rejects.toThrow('bad call');
    expect(flight.size).toBe(0);
  });

  it('holds the key only while the task is in flight', async () => {
    const flight = createSingleFlight<string, string>();
    const gate = deferred<string>();

    const running = flight.run('k', () => gate.promise);
    expect(flight.size).toBe(1);

    gate.resolve('done');
    await running;
    expect(flight.size).toBe(0);
  });
});
