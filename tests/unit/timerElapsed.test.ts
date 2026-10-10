import { describe, expect, it } from 'vitest';
import {
  ELAPSED_GRACE_MS,
  findElapsedTimers,
  type TimerCandidate,
} from '@main/notifications/timerElapsed';

const NOW = 1_700_000_000_000;

function candidate(overrides: Partial<TimerCandidate>): TimerCandidate {
  return { characterId: 1, characterName: 'Test Character', deadline: null, ...overrides };
}

describe('findElapsedTimers', () => {
  it('reports a timer that ran out inside the grace window', () => {
    const deadline = new Date(NOW - 60_000).toISOString();
    expect(findElapsedTimers([candidate({ deadline })], NOW)).toEqual([
      { characterId: 1, characterName: 'Test Character', deadline },
    ]);
  });

  it('counts a deadline of exactly now as elapsed', () => {
    const deadline = new Date(NOW).toISOString();
    expect(findElapsedTimers([candidate({ deadline })], NOW)).toHaveLength(1);
  });

  it('reports a timer at the far edge of the grace window', () => {
    const deadline = new Date(NOW - ELAPSED_GRACE_MS).toISOString();
    expect(findElapsedTimers([candidate({ deadline })], NOW)).toHaveLength(1);
  });

  it('stays quiet once the deadline is older than the grace window', () => {
    const deadline = new Date(NOW - ELAPSED_GRACE_MS - 1).toISOString();
    expect(findElapsedTimers([candidate({ deadline })], NOW)).toHaveLength(0);
  });

  it('stays quiet on a long-past deadline, so a first sweep does not announce old jumps', () => {
    const deadline = new Date(NOW - 90 * 24 * 60 * 60 * 1000).toISOString();
    expect(findElapsedTimers([candidate({ deadline })], NOW)).toHaveLength(0);
  });

  it('stays quiet while the timer is still running', () => {
    const deadline = new Date(NOW + 60_000).toISOString();
    expect(findElapsedTimers([candidate({ deadline })], NOW)).toHaveLength(0);
  });

  it('stays quiet when there is no timer at all', () => {
    expect(findElapsedTimers([candidate({ deadline: null })], NOW)).toHaveLength(0);
  });

  it('stays quiet on a malformed deadline', () => {
    expect(findElapsedTimers([candidate({ deadline: 'not-a-date' })], NOW)).toHaveLength(0);
  });

  it('returns an empty array for no candidates', () => {
    expect(findElapsedTimers([], NOW)).toEqual([]);
  });

  it('returns exactly the elapsed subset among mixed candidates', () => {
    const justEnded = new Date(NOW - 5 * 60_000).toISOString();
    const stale = new Date(NOW - ELAPSED_GRACE_MS - 60_000).toISOString();
    const running = new Date(NOW + 3 * 60 * 60_000).toISOString();

    const elapsed = findElapsedTimers(
      [
        candidate({ characterId: 1, characterName: 'Ended', deadline: justEnded }),
        candidate({ characterId: 2, characterName: 'Stale', deadline: stale }),
        candidate({ characterId: 3, characterName: 'Running', deadline: running }),
        candidate({ characterId: 4, characterName: 'NoTimer', deadline: null }),
      ],
      NOW,
    );

    expect(elapsed).toEqual([{ characterId: 1, characterName: 'Ended', deadline: justEnded }]);
  });
});
