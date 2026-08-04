import { describe, expect, it } from 'vitest';
import { isBackgroundLaunch, shouldQuitOnWindowClose } from '@main/launchMode';

describe('isBackgroundLaunch', () => {
  it('detects the flag in a packaged-app argv', () => {
    expect(isBackgroundLaunch(['C:\\Program Files\\MCO\\MCO.exe', '--background'])).toBe(true);
  });

  it('detects the flag in a dev argv', () => {
    expect(isBackgroundLaunch(['electron', '.', '--background'])).toBe(true);
  });

  it('returns false when the flag is absent', () => {
    expect(isBackgroundLaunch(['MCO.exe'])).toBe(false);
  });

  it('matches the exact token only', () => {
    expect(isBackgroundLaunch(['MCO.exe', '--backgrounder'])).toBe(false);
    expect(isBackgroundLaunch(['MCO.exe', '--background=1'])).toBe(false);
  });

  it('finds the flag among other switches', () => {
    expect(isBackgroundLaunch(['MCO.exe', '--allow-file-access', '--background'])).toBe(true);
  });
});

describe('shouldQuitOnWindowClose', () => {
  it('quits on Windows/Linux when not resident in the tray', () => {
    expect(shouldQuitOnWindowClose({ platform: 'win32', residentInTray: false })).toBe(true);
    expect(shouldQuitOnWindowClose({ platform: 'linux', residentInTray: false })).toBe(true);
  });

  it('stays alive when resident, so the sync sweep survives the window', () => {
    expect(shouldQuitOnWindowClose({ platform: 'win32', residentInTray: true })).toBe(false);
    expect(shouldQuitOnWindowClose({ platform: 'linux', residentInTray: true })).toBe(false);
  });

  it('never quits on macOS, resident or not', () => {
    expect(shouldQuitOnWindowClose({ platform: 'darwin', residentInTray: false })).toBe(false);
    expect(shouldQuitOnWindowClose({ platform: 'darwin', residentInTray: true })).toBe(false);
  });
});
