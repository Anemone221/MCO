import { describe, expect, it } from 'vitest';
import { flagPodsOutsideWhitelist, type PodCheckInput } from '@main/clones/podWhitelist';

const JITA = 30000142;
const AMARR = 30002187;
const RENS = 30002510;

const ALLOWED = new Set([JITA, AMARR]);

/** Station 60003760 is in Jita, structure 1000000000001 is in Rens. */
function systemOf(locationType: string | null, locationId: number | null): number | null {
  if (locationType === 'station' && locationId === 60003760) return JITA;
  if (locationType === 'station' && locationId === 60004588) return RENS;
  if (locationType === 'structure' && locationId === 1000000000001) return RENS;
  return null;
}

function input(overrides: Partial<PodCheckInput> = {}): PodCheckInput {
  return { activeImplantCount: 0, activeSystemId: null, clones: [], ...overrides };
}

function clone(overrides: Partial<PodCheckInput['clones'][number]> = {}) {
  return {
    jumpCloneId: 1,
    name: null,
    locationId: 60003760 as number | null,
    locationType: 'station' as string | null,
    implantCount: 5,
    ...overrides,
  };
}

describe('flagPodsOutsideWhitelist', () => {
  it('returns nothing when the whitelist is empty (check disabled)', () => {
    const pods = input({
      activeImplantCount: 5,
      activeSystemId: RENS,
      clones: [clone({ locationId: 60004588 })],
    });
    expect(flagPodsOutsideWhitelist(pods, new Set(), systemOf)).toEqual([]);
  });

  it('flags the active pod when it carries implants outside the whitelist', () => {
    const flags = flagPodsOutsideWhitelist(
      input({ activeImplantCount: 3, activeSystemId: RENS }),
      ALLOWED,
      systemOf,
    );
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({ kind: 'active', implantCount: 3, systemId: RENS });
  });

  it('does not flag the active pod inside a whitelisted system', () => {
    const flags = flagPodsOutsideWhitelist(
      input({ activeImplantCount: 3, activeSystemId: JITA }),
      ALLOWED,
      systemOf,
    );
    expect(flags).toEqual([]);
  });

  it('ignores an active pod with no implants', () => {
    const flags = flagPodsOutsideWhitelist(
      input({ activeImplantCount: 0, activeSystemId: RENS }),
      ALLOWED,
      systemOf,
    );
    expect(flags).toEqual([]);
  });

  it('does not flag the active pod when its location has never synced', () => {
    const flags = flagPodsOutsideWhitelist(
      input({ activeImplantCount: 3, activeSystemId: null }),
      ALLOWED,
      systemOf,
    );
    expect(flags).toEqual([]);
  });

  it('flags an implanted jump clone parked outside the whitelist', () => {
    const flags = flagPodsOutsideWhitelist(
      input({ clones: [clone({ jumpCloneId: 7, name: 'Slave set', locationId: 60004588 })] }),
      ALLOWED,
      systemOf,
    );
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({
      kind: 'jump-clone',
      jumpCloneId: 7,
      cloneName: 'Slave set',
      systemId: RENS,
    });
  });

  it('does not flag an implanted jump clone inside a whitelisted system', () => {
    const flags = flagPodsOutsideWhitelist(input({ clones: [clone()] }), ALLOWED, systemOf);
    expect(flags).toEqual([]);
  });

  it('ignores jump clones without implants wherever they are', () => {
    const flags = flagPodsOutsideWhitelist(
      input({ clones: [clone({ implantCount: 0, locationId: 60004588 })] }),
      ALLOWED,
      systemOf,
    );
    expect(flags).toEqual([]);
  });

  it('resolves structures too, and flags one outside the whitelist', () => {
    const flags = flagPodsOutsideWhitelist(
      input({ clones: [clone({ locationId: 1000000000001, locationType: 'structure' })] }),
      ALLOWED,
      systemOf,
    );
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({ kind: 'jump-clone', systemId: RENS });
  });

  it('flags an implanted jump clone at an unresolvable structure with a null system', () => {
    const flags = flagPodsOutsideWhitelist(
      input({ clones: [clone({ locationId: 1000000000099, locationType: 'structure' })] }),
      ALLOWED,
      systemOf,
    );
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({ kind: 'jump-clone', systemId: null });
  });

  it('reports every offending pod of one character, active first', () => {
    const flags = flagPodsOutsideWhitelist(
      input({
        activeImplantCount: 1,
        activeSystemId: RENS,
        clones: [
          clone({ jumpCloneId: 1 }), // Jita — fine
          clone({ jumpCloneId: 2, locationId: 60004588 }), // Rens — flagged
        ],
      }),
      ALLOWED,
      systemOf,
    );
    expect(flags.map((f) => f.kind)).toEqual(['active', 'jump-clone']);
    expect(flags[1]).toMatchObject({ jumpCloneId: 2 });
  });
});
