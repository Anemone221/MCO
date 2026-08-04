/**
 * The host environment sets ELECTRON_RUN_AS_NODE=1, which would make Electron
 * run as plain Node (no window). Strip it before launching the app.
 */
export function appEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== 'ELECTRON_RUN_AS_NODE') env[key] = value;
  }
  return env;
}
