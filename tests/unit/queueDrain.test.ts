import { describe, expect, it } from 'vitest';
import {
  findQueueDrainWarnings,
  WARNING_WINDOW_MS,
  type QueueDrainCandidate,
} from '@main/notifications/queueDrain';

const NOW = 1_700_000_000_000;

function candidate(overrides: Partial<QueueDrainCandidate>): QueueDrainCandidate {
  return {
    characterId: 1,
    characterName: 'Test Character',
    finishDate: null,
    queueLength: 0,
    skillTypeId: null,
    ...overrides,
  };
}

describe('findQueueDrainWarnings', () => {
  it('warns when the sole queued skill finishes within the window', () => {
    const finishDate = new Date(NOW + 2 * 24 * 60 * 60 * 1000).toISOString();
    const warnings = findQueueDrainWarnings(
      [candidate({ queueLength: 1, finishDate, skillTypeId: 100 })],
      NOW,
    );
    expect(warnings).toEqual([
      { characterId: 1, characterName: 'Test Character', finishDate, skillTypeId: 100 },
    ]);
  });

  it('warns at the exact boundary of the warning window', () => {
    const finishDate = new Date(NOW + WARNING_WINDOW_MS).toISOString();
    const warnings = findQueueDrainWarnings(
      [candidate({ queueLength: 1, finishDate })],
      NOW,
    );
    expect(warnings).toHaveLength(1);
  });

  it('does not warn just past the boundary of the warning window', () => {
    const finishDate = new Date(NOW + WARNING_WINDOW_MS + 1).toISOString();
    const warnings = findQueueDrainWarnings(
      [candidate({ queueLength: 1, finishDate })],
      NOW,
    );
    expect(warnings).toHaveLength(0);
  });

  it('does not warn when finishDate is in the past', () => {
    const finishDate = new Date(NOW - 60_000).toISOString();
    const warnings = findQueueDrainWarnings(
      [candidate({ queueLength: 1, finishDate })],
      NOW,
    );
    expect(warnings).toHaveLength(0);
  });

  it('does not warn when finishDate equals now', () => {
    const finishDate = new Date(NOW).toISOString();
    const warnings = findQueueDrainWarnings(
      [candidate({ queueLength: 1, finishDate })],
      NOW,
    );
    expect(warnings).toHaveLength(0);
  });

  it('does not warn when the queue is already empty', () => {
    const warnings = findQueueDrainWarnings(
      [candidate({ queueLength: 0, finishDate: null })],
      NOW,
    );
    expect(warnings).toHaveLength(0);
  });

  it('does not warn when another skill is queued behind the current one', () => {
    const finishDate = new Date(NOW + 60_000).toISOString();
    const warnings = findQueueDrainWarnings(
      [candidate({ queueLength: 2, finishDate })],
      NOW,
    );
    expect(warnings).toHaveLength(0);
  });

  it('does not warn on a malformed finishDate', () => {
    const warnings = findQueueDrainWarnings(
      [candidate({ queueLength: 1, finishDate: 'not-a-date' })],
      NOW,
    );
    expect(warnings).toHaveLength(0);
  });

  it('returns an empty array for no candidates', () => {
    expect(findQueueDrainWarnings([], NOW)).toEqual([]);
  });

  it('returns exactly the warned subset among mixed candidates', () => {
    const soon = new Date(NOW + 60_000).toISOString();
    const far = new Date(NOW + WARNING_WINDOW_MS * 2).toISOString();
    const warnings = findQueueDrainWarnings(
      [
        candidate({ characterId: 1, characterName: 'Warned', queueLength: 1, finishDate: soon }),
        candidate({ characterId: 2, characterName: 'TooFar', queueLength: 1, finishDate: far }),
        candidate({ characterId: 3, characterName: 'Stacked', queueLength: 3, finishDate: soon }),
      ],
      NOW,
    );
    expect(warnings).toEqual([
      { characterId: 1, characterName: 'Warned', finishDate: soon, skillTypeId: null },
    ]);
  });

  it('passes through a null skillTypeId on a warned candidate', () => {
    const finishDate = new Date(NOW + 60_000).toISOString();
    const warnings = findQueueDrainWarnings(
      [candidate({ queueLength: 1, finishDate, skillTypeId: null })],
      NOW,
    );
    expect(warnings[0]!.skillTypeId).toBeNull();
  });
});
