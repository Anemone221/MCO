/**
 * The host environment sets ELECTRON_RUN_AS_NODE=1, which would make Electron
 * run as plain Node (no window). Strip it before launching the app.
 *
 * Also pins MCO_UPDATE_CHECK=0: the packaged suite launches a real packaged
 * build, where the release check would otherwise go out to GitHub's API on
 * every run — a network call the tests don't need and shouldn't spend a CI
 * runner's shared unauthenticated rate limit on. MCO_SDE_CHECK=0 keeps the
 * static data build check off the network for the same reason.
 */
export function appEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== 'ELECTRON_RUN_AS_NODE') env[key] = value;
  }
  env['MCO_UPDATE_CHECK'] = '0';
  env['MCO_SDE_CHECK'] = '0';
  return env;
}
