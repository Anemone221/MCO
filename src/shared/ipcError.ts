/**
 * The error half of the IPC contract, shared by both sides of the bridge.
 *
 * Main normalizes what a failing handler is allowed to say (`src/main/errors.ts`);
 * the preload unwraps Electron's plumbing so the renderer can print the result
 * as a plain sentence.
 */

/** Shown when a handler failed for a reason the user can do nothing about. */
export const GENERIC_ERROR_MESSAGE =
  'Something went wrong. Settings → Export logs has the details.';

/**
 * Electron re-wraps a rejected `ipcMain.handle` before the renderer sees it:
 *
 *     Error invoking remote method 'tags:create': Error: That name is already in use.
 *
 * Both prefixes are plumbing — the channel name means nothing to the user, and
 * the inner `Error:` is an artifact of rethrowing. Strip them so a page can
 * render the message directly.
 */
const REMOTE_METHOD_PREFIX = /^Error invoking remote method '[^']*':\s*/;
const ERROR_NAME_PREFIX = /^[A-Za-z]*Error:\s*/;

/** The displayable sentence inside an error from an IPC call. */
export function cleanIpcErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const message = raw.replace(REMOTE_METHOD_PREFIX, '').replace(ERROR_NAME_PREFIX, '').trim();
  return message.length > 0 ? message : GENERIC_ERROR_MESSAGE;
}
