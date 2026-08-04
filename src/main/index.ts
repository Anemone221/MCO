import { app, BrowserWindow, nativeImage, shell } from 'electron';
import { join } from 'node:path';
import appIconPath from '../../resources/icon.png?asset';
import { closeDb, getDb } from './db';
import { initLogCapture } from './log';
import { registerIpc } from './ipc/register';
import { isBackgroundLaunch, shouldQuitOnWindowClose } from './launchMode';
import {
  destroyTray,
  initBackgroundMode,
  isResidentInTray,
  noteWindowClosedIntoTray,
} from './services/backgroundMode';
import { runSweepNow, startScheduler, stopScheduler } from './services/scheduler';

// Capture console output from the very start so "Export logs" sees everything.
initLogCapture();

// Required for Windows toast notifications to display reliably under the nsis
// build target, which (unlike Squirrel) does not auto-register the AUMID.
//
// Dev must NOT claim the packaged identity. Windows resolves an AUMID to the Start
// menu shortcut declaring it, and auto-creates that shortcut for whatever exe is
// running the first time it shows a toast. In dev that exe is
// node_modules/electron/dist/electron.exe, so a dev run would register an "Electron"
// shortcut under com.anemone221.mco and hijack it — the installed app's taskbar
// button then resolves through that shortcut and renders Electron's icon.
app.setAppUserModelId(app.isPackaged ? 'com.anemone221.mco' : 'com.anemone221.mco.dev');

/** Tray-only background sync runner mode (no window unless promoted). */
const backgroundMode = isBackgroundLaunch(process.argv);

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    title: 'MCO — Massive Character Organization',
    // Window/taskbar icon for dev and Linux; the packaged Windows exe and macOS
    // bundle carry their own icon from electron-builder (build/icon.*). Load via
    // nativeImage (like the tray) — a raw string path into app.asar isn't
    // reliably loaded as a window icon and falls back to the default Electron icon.
    icon: nativeImage.createFromPath(appIconPath),
    backgroundColor: '#0d1117',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.on('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  if (process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

/** Create the window, or focus it if it already exists. */
function openMainWindow(): void {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  } else {
    createWindow();
  }
}

// One MCO process per profile, in either mode: EVE SSO rotates refresh tokens
// on every refresh, so two processes racing a refresh can invalidate the token
// family and deauth a character.
if (!app.requestSingleInstanceLock({ background: backgroundMode })) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv, _workingDirectory, additionalData) => {
    const secondIsBackground =
      (additionalData as { background?: boolean } | null)?.background ?? isBackgroundLaunch(argv);
    // A normal launch promotes this instance to the full UI; a second
    // background launch is a no-op since the sync is already running.
    if (!secondIsBackground) openMainWindow();
  });

  void app.whenReady().then(() => {
    getDb(); // open the database and run migrations before any IPC handler can fire
    // Reads the close-to-tray preference, so it must follow getDb(). Raises the
    // tray itself when this profile wants one (background launch or the pref).
    const background = initBackgroundMode({
      openWindow: openMainWindow,
      closeWindow: () => mainWindow?.close(),
      runSyncNow: () => void runSweepNow(),
      launchedInBackground: backgroundMode,
    });
    registerIpc(() => mainWindow); // both modes — the promoted window needs IPC
    startScheduler(() => mainWindow);
    // A background launch with no tray icon (desktops without a notification
    // area) would be unreachable, so fall back to a normal window.
    if (!backgroundMode || !background.trayActive) createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  // Resident = launched with --background, close-to-tray enabled, or "Run in
  // background now": the window goes away but the sync sweep carries on, with
  // the tray icon as the way back in.
  const residentInTray = isResidentInTray();
  if (residentInTray) noteWindowClosedIntoTray();
  if (shouldQuitOnWindowClose({ platform: process.platform, residentInTray })) app.quit();
});

app.on('quit', () => {
  destroyTray();
  stopScheduler();
  closeDb();
});
