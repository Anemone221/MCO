/** True when this process was launched as the tray-only background sync runner. */
export function isBackgroundLaunch(argv: readonly string[]): boolean {
  return argv.includes('--background');
}
