import { GENERIC_ERROR_MESSAGE } from '@shared/ipcError';

/**
 * What a failing IPC handler is allowed to tell the renderer.
 *
 * Every throw is logged in full first (see `ipc/register.ts`), so nothing is
 * lost — but most messages are written for a developer reading a stack trace,
 * not for the user: record ids they never see (`Unknown character 123`), ESI
 * paths and raw response bodies, SQL text on a constraint failure. Those are
 * replaced; messages deliberately written *for* the user are not.
 */

/**
 * Marks a message as user-facing copy, passed across the bridge verbatim.
 *
 * Throw this for the failures a user can act on — malformed EFT text, a missing
 * ESI scope, an unconfigured client_id. Plain `Error` stays the default, so a
 * message only reaches the UI when someone chose to put it there.
 */
export class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserFacingError';
  }
}

/** better-sqlite3 tags its errors with the extended result code, e.g. SQLITE_CONSTRAINT_UNIQUE. */
function errorCode(err: unknown): string | null {
  if (typeof err !== 'object' || err === null) return null;
  const { code } = err as { code?: unknown };
  return typeof code === 'string' ? code : null;
}

/** The message to send the renderer for a thrown value. */
export function toUserMessage(err: unknown): string {
  if (err instanceof UserFacingError) return err.message;

  // tags(name) is the only unique index a user action can trip. better-sqlite3's
  // own message names the table and column ("UNIQUE constraint failed: tags.name"),
  // so map the code rather than forwarding the text.
  if (errorCode(err) === 'SQLITE_CONSTRAINT_UNIQUE') return 'That name is already in use.';

  return GENERIC_ERROR_MESSAGE;
}
