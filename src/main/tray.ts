import { app, Menu, nativeImage, Tray } from 'electron';
import trayIconPath from '../../resources/tray.png?asset';

/**
 * Tray icon for the background sync runner. The caller must keep the returned
 * Tray referenced for the lifetime of the app, or the icon is garbage-collected.
 */
export function createBackgroundTray(opts: {
  onOpen: () => void;
  onRunSync: () => void;
}): Tray {
  const tray = new Tray(nativeImage.createFromPath(trayIconPath));
  tray.setToolTip('MCO — background sync');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open MCO', click: opts.onOpen },
      { label: 'Run sync now', click: opts.onRunSync },
      { type: 'separator' },
      { label: 'Quit MCO', click: () => app.quit() },
    ]),
  );
  tray.on('double-click', opts.onOpen);
  return tray;
}
