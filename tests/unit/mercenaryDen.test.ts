import { describe, expect, it } from 'vitest';
import {
  ANARCHY_ALERT_LEVEL,
  denAttention,
  denStatus,
  isOpenOperation,
  isReinforced,
  mercenaryLevel,
  operationStatus,
} from '@main/mercenary/den';

const NOW = new Date('2026-08-28T12:00:00Z');
const LATER = '2026-08-28T18:00:00Z';
const EARLIER = '2026-08-28T06:00:00Z';

describe('mercenaryLevel', () => {
  it('reads ESI’s level strings as numbers', () => {
    expect(mercenaryLevel('Level0')).toBe(0);
    expect(mercenaryLevel('Level4')).toBe(4);
  });

  it('distinguishes “no anarchy” from “ESI did not say”', () => {
    // Level0 is a reading; Unspecified is the absence of one. Collapsing the
    // two would render an unknown den as a pristine one.
    expect(mercenaryLevel('Level0')).toBe(0);
    expect(mercenaryLevel('Unspecified')).toBeNull();
    expect(mercenaryLevel(null)).toBeNull();
  });

  it('rejects a level outside the scale rather than inventing one', () => {
    expect(mercenaryLevel('Level9')).toBeNull();
    expect(mercenaryLevel('Level')).toBeNull();
    expect(mercenaryLevel('running')).toBeNull();
  });
});

describe('isReinforced', () => {
  it('is true only while the timer is still ahead', () => {
    expect(isReinforced(LATER, NOW)).toBe(true);
    expect(isReinforced(EARLIER, NOW)).toBe(false);
  });

  it('treats a missing or unparseable timer as not reinforced', () => {
    expect(isReinforced(null, NOW)).toBe(false);
    expect(isReinforced('soon', NOW)).toBe(false);
  });
});

describe('denStatus', () => {
  it('separates a reinforced den from a merely paused one', () => {
    // ESI calls both `Paused`; only the timer tells them apart.
    expect(denStatus({ state: 'Paused', reinforcementEnd: LATER, now: NOW })).toBe('reinforced');
    expect(denStatus({ state: 'Paused', reinforcementEnd: null, now: NOW })).toBe('paused');
  });

  it('drops back out of reinforced once the timer has passed', () => {
    expect(denStatus({ state: 'Paused', reinforcementEnd: EARLIER, now: NOW })).toBe('paused');
  });

  it('lets a running timer outrank whatever state ESI reports', () => {
    expect(denStatus({ state: 'Running', reinforcementEnd: LATER, now: NOW })).toBe('reinforced');
  });

  it('maps the plain states through', () => {
    expect(denStatus({ state: 'Running', reinforcementEnd: null, now: NOW })).toBe('running');
    expect(denStatus({ state: 'Disabled', reinforcementEnd: null, now: NOW })).toBe('disabled');
  });

  it('reads Unspecified and “never synced” as the same unknown', () => {
    expect(denStatus({ state: 'Unspecified', reinforcementEnd: null, now: NOW })).toBe('unknown');
    expect(denStatus({ state: null, reinforcementEnd: null, now: NOW })).toBe('unknown');
  });
});

describe('operationStatus', () => {
  it('does not offer an operation whose clock has run out', () => {
    // Stored data still says Available; the expiry is what settles it.
    expect(operationStatus({ state: 'Available', expires: EARLIER, now: NOW })).toBe('expired');
    expect(operationStatus({ state: 'Available', expires: LATER, now: NOW })).toBe('available');
  });

  it('keeps a started operation its own state past its expiry', () => {
    expect(operationStatus({ state: 'Started', expires: EARLIER, now: NOW })).toBe('started');
  });

  it('passes ESI’s terminal states through', () => {
    expect(operationStatus({ state: 'Completed', expires: EARLIER, now: NOW })).toBe('completed');
    expect(operationStatus({ state: 'Removed', expires: LATER, now: NOW })).toBe('removed');
  });

  it('falls back to the clock when the state is unknown', () => {
    expect(operationStatus({ state: null, expires: EARLIER, now: NOW })).toBe('expired');
    expect(operationStatus({ state: null, expires: null, now: NOW })).toBe('unknown');
  });
});

describe('isOpenOperation', () => {
  it('counts only what can still be acted on', () => {
    expect(isOpenOperation('available')).toBe(true);
    expect(isOpenOperation('started')).toBe(true);
    expect(isOpenOperation('completed')).toBe(false);
    expect(isOpenOperation('expired')).toBe(false);
    expect(isOpenOperation('removed')).toBe(false);
  });
});

describe('denAttention', () => {
  const base = { status: 'running' as const, anarchyLevel: 0, openOperations: 0 };

  it('ranks a reinforcement above everything else', () => {
    expect(denAttention({ ...base, status: 'reinforced' })).toBeGreaterThan(
      denAttention({ ...base, status: 'disabled' }),
    );
  });

  it('ranks a disabled den above one merely accumulating anarchy', () => {
    expect(denAttention({ ...base, status: 'disabled' })).toBeGreaterThan(
      denAttention({ ...base, anarchyLevel: ANARCHY_ALERT_LEVEL }),
    );
  });

  it('raises anarchy only once it starts costing something', () => {
    expect(denAttention({ ...base, anarchyLevel: ANARCHY_ALERT_LEVEL - 1 })).toBe(0);
    expect(denAttention({ ...base, anarchyLevel: ANARCHY_ALERT_LEVEL })).toBe(2);
  });

  it('nudges a quiet den that has work waiting', () => {
    expect(denAttention({ ...base, openOperations: 2 })).toBe(1);
  });

  it('leaves a den that is doing its job at zero', () => {
    // The common case on a 90-character roster: it must sort to the bottom.
    expect(denAttention(base)).toBe(0);
    expect(denAttention({ ...base, anarchyLevel: null })).toBe(0);
  });
});
