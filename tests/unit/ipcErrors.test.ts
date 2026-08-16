import { describe, expect, it } from 'vitest';
import { UserFacingError, toUserMessage } from '@main/errors';
import { GENERIC_ERROR_MESSAGE, cleanIpcErrorMessage } from '@shared/ipcError';
import { parseEft } from '@main/fits/eft';
import { parseSkillPlan } from '@main/plans/parse';

/** A better-sqlite3 SqliteError, as far as the boundary is concerned. */
function sqliteError(code: string, message: string): Error {
  return Object.assign(new Error(message), { name: 'SqliteError', code });
}

describe('toUserMessage', () => {
  it('passes a UserFacingError through verbatim', () => {
    const message = 'Not a valid EFT fit — the first line must be "[Ship, Fit name]"';
    expect(toUserMessage(new UserFacingError(message))).toBe(message);
  });

  it('replaces messages written for a developer', () => {
    expect(toUserMessage(new Error('Unknown character 2114794365'))).toBe(GENERIC_ERROR_MESSAGE);
    expect(
      toUserMessage(new Error('ESI GET /v5/characters/93/skills/ failed: 500 {"e":"x"}')),
    ).toBe(GENERIC_ERROR_MESSAGE);
  });

  it('names the conflict on a unique-constraint failure without echoing the SQL', () => {
    const err = sqliteError('SQLITE_CONSTRAINT_UNIQUE', 'UNIQUE constraint failed: tags.name');
    const message = toUserMessage(err);

    expect(message).toBe('That name is already in use.');
    expect(message).not.toContain('tags.name');
  });

  it('does not guess at other constraint failures', () => {
    const err = sqliteError('SQLITE_CONSTRAINT_FOREIGNKEY', 'FOREIGN KEY constraint failed');
    expect(toUserMessage(err)).toBe(GENERIC_ERROR_MESSAGE);
  });

  it('handles values that are not Errors at all', () => {
    expect(toUserMessage('boom')).toBe(GENERIC_ERROR_MESSAGE);
    expect(toUserMessage(null)).toBe(GENERIC_ERROR_MESSAGE);
    expect(toUserMessage({ code: 42 })).toBe(GENERIC_ERROR_MESSAGE);
  });
});

describe('cleanIpcErrorMessage', () => {
  it('strips the wrapper Electron puts around a rejected handler', () => {
    const err = new Error(
      "Error invoking remote method 'tags:create': Error: That name is already in use.",
    );
    expect(cleanIpcErrorMessage(err)).toBe('That name is already in use.');
  });

  it('strips the error name of a handler that bypassed the boundary', () => {
    const err = new Error(
      "Error invoking remote method 'tags:create': SqliteError: UNIQUE constraint failed: tags.name",
    );
    expect(cleanIpcErrorMessage(err)).toBe('UNIQUE constraint failed: tags.name');
  });

  it('leaves a message that carries no plumbing alone', () => {
    expect(cleanIpcErrorMessage(new Error('Empty fit text'))).toBe('Empty fit text');
  });

  it('falls back when there is no message to show', () => {
    expect(cleanIpcErrorMessage(new Error(''))).toBe(GENERIC_ERROR_MESSAGE);
    expect(cleanIpcErrorMessage(undefined)).toBe('undefined');
  });
});

describe('parser errors reach the user', () => {
  // These messages are the whole feedback for a bad paste on the Fits/Plans
  // pages. Throwing a plain Error instead would silently swap them for the
  // generic line, so assert the round trip rather than the class.
  function messageFor(run: () => unknown): string {
    try {
      run();
    } catch (err) {
      return toUserMessage(err);
    }
    throw new Error('expected a throw');
  }

  it('keeps EFT parse failures', () => {
    expect(messageFor(() => parseEft(''))).toBe('Empty fit text');
    expect(messageFor(() => parseEft('just some text'))).toContain('Not a valid EFT fit');
  });

  it('keeps skill-plan parse failures', () => {
    expect(messageFor(() => parseSkillPlan(''))).toBe('Empty plan text');
    expect(messageFor(() => parseSkillPlan('just a title'))).toContain('No valid "skill level"');
  });
});
