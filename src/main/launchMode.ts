/** True when this process was launched as the tray-only background sync runner. */
export function isBackgroundLaunch(argv: readonly string[]): boolean {
  return argv.includes('--background');
}

/**
 * Whether closing the last window should quit the app.
 *
 * Staying resident is what keeps the hourly sweep alive with no window: the
 * process is only kept around because a tray icon is up to get back to it.
 * macOS keeps its usual behaviour (apps outlive their windows) even when not
 * resident, so the dock icon still reopens the window.
 */
export function shouldQuitOnWindowClose(opts: {
  platform: NodeJS.Platform;
  residentInTray: boolean;
}): boolean {
  if (opts.residentInTray) return false;
  return opts.platform !== 'darwin';
}
