/**
 * What the renderer is allowed to make the OS and the window do.
 *
 * The renderer is sandboxed and context-isolated, so these are second-line
 * defences: they decide what still can't happen if a bug (or a dependency) ever
 * gets to drive navigation or hand a URL to the shell. Kept as pure predicates
 * so the policy is unit-tested rather than asserted by reading `index.ts`.
 */

/**
 * Schemes MCO will hand to the operating system.
 *
 * `shell.openExternal` launches whatever handler the OS has registered for a
 * scheme, which on Windows includes a long tail of local application protocols
 * — `file:` opens a path in Explorer, and handlers of the `ms-*:` family have
 * repeatedly been the pivot in one-click attack chains. Every link MCO has a
 * reason to open (its GitHub page, EVE SSO, CCP's docs) is http(s).
 */
const EXTERNAL_PROTOCOLS = new Set(['http:', 'https:']);

/** Whether a URL may be opened in the user's browser. */
export function isSafeExternalUrl(url: string): boolean {
  try {
    return EXTERNAL_PROTOCOLS.has(new URL(url).protocol);
  } catch {
    return false; // unparseable is not openable
  }
}

/**
 * Whether the renderer may navigate the window itself to `target`.
 *
 * Only the document MCO loaded qualifies. In-app routing goes through
 * react-router's history API, which never raises `will-navigate`, so anything
 * that does reach this is a real page load — and a renderer that has navigated
 * somewhere remote would be running that page against MCO's preload bridge.
 *
 * `file:` URLs compare by path (their origin is the opaque "null", which would
 * make every local file look same-origin); the dev server compares by origin.
 */
export function isAllowedNavigation(target: string, appUrl: string): boolean {
  let to: URL;
  let app: URL;
  try {
    to = new URL(target);
    app = new URL(appUrl);
  } catch {
    return false;
  }
  if (to.protocol !== app.protocol) return false;
  return app.protocol === 'file:' ? to.pathname === app.pathname : to.origin === app.origin;
}
