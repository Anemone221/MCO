import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { McoApi } from '@shared/ipc';

/**
 * `lib/ipc.ts` re-declares the methods it scrubs for demo mode, and a wrapper
 * that names *fewer* parameters than `McoApi` still satisfies it — TypeScript
 * allows a shorter function where a longer one is expected. So a dropped
 * argument type-checks, lints, and silently disables whatever it controlled:
 * exactly how `location.nearest`'s jump-clone flag never reached the main
 * process.
 *
 * This pins the pass-through for every wrapped method that takes arguments.
 * A new one belongs in the table below.
 */

/** Every call the fake preload saw, in order. */
let calls: Array<{ path: string; args: unknown[] }> = [];

/** A preload stand-in that records its arguments and answers with empty data. */
function fakePreload(): McoApi {
  const record =
    (path: string, result: unknown = null) =>
    (...args: unknown[]): Promise<unknown> => {
      calls.push({ path, args });
      return Promise.resolve(result);
    };

  return {
    characters: { detail: record('characters.detail', { skills: [], plans: [] }) },
    accounts: {},
    groups: { detail: record('groups.detail', { members: [], objectives: [] }) },
    tags: {},
    sde: {},
    fits: { analyze: record('fits.analyze', { characters: [] }) },
    plans: { analyze: record('plans.analyze', { characters: [] }) },
    location: { nearest: record('location.nearest', { target: {}, entries: [] }) },
    structures: { search: record('structures.search', []) },
    systems: { search: record('systems.search', []) },
    clones: {},
    blueprints: {},
    dashboard: {},
    wallet: {},
    notifications: {},
    system: {},
    settings: {},
  } as unknown as McoApi;
}

async function loadApi(): Promise<McoApi> {
  vi.resetModules();
  (globalThis as { window?: unknown }).window = { mco: fakePreload() };
  return (await import('@renderer/lib/ipc')).mco;
}

beforeEach(() => {
  calls = [];
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe('the demo-mode wrapper', () => {
  it('forwards the jump-clone flag to location.nearest', async () => {
    const mco = await loadApi();

    await mco.location.nearest(30002537, true);

    expect(calls).toEqual([{ path: 'location.nearest', args: [30002537, true] }]);
  });

  it('forwards a false jump-clone flag rather than dropping it', async () => {
    const mco = await loadApi();

    await mco.location.nearest(30002537, false);

    expect(calls[0]?.args).toEqual([30002537, false]);
  });

  it('forwards the arguments of every other wrapped method', async () => {
    const mco = await loadApi();

    await mco.characters.detail(90000001);
    await mco.groups.detail(7);
    await mco.fits.analyze(11);
    await mco.plans.analyze(12);
    await mco.structures.search('keepstar');
    await mco.systems.search('Amamake');

    expect(calls).toEqual([
      { path: 'characters.detail', args: [90000001] },
      { path: 'groups.detail', args: [7] },
      { path: 'fits.analyze', args: [11] },
      { path: 'plans.analyze', args: [12] },
      { path: 'structures.search', args: ['keepstar'] },
      { path: 'systems.search', args: ['Amamake'] },
    ]);
  });
});
