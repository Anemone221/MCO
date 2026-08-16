import { app, BrowserWindow, dialog, nativeImage, session, shell } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import appIconPath from '../../resources/icon.png?asset';
import { isAllowedNavigation, isSafeExternalUrl } from './webSecurity';
import { closeDb, getDb } from './db';
import { SchemaVersionError } from './db/migrations';
import { initFatalErrorHandler } from './fatal';
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
// Must follow initLogCapture(): a crash report is only worth writing once there
// is a captured buffer to write into it.
initFatalErrorHandler();

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

  // A link never opens in-app: it goes to the user's browser, and only if it is
  // an http(s) URL. Handing an arbitrary scheme to the OS would let anything
  // that can put a URL on the page launch a local protocol handler.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url);
    else console.warn(`[security] refused to open a non-http(s) URL externally: ${url}`);
    return { action: 'deny' };
  });

  const rendererUrl = process.env['ELECTRON_RENDERER_URL'];
  const appUrl = rendererUrl ?? pathToFileURL(join(__dirname, '../renderer/index.html')).toString();

  // The window stays on the document MCO loaded. React-router navigates through
  // the history API and never raises this, so anything that does is a real page
  // load — which for a remote URL would mean running that page against MCO's
  // preload bridge.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isAllowedNavigation(url, appUrl)) return;
    event.preventDefault();
    console.warn(`[security] blocked in-window navigation to ${url}`);
  });

  if (rendererUrl) {
    void mainWindow.loadURL(rendererUrl);
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
    // Opening the profile is the one startup step with a failure mode users hit
    // on their own — reinstalling an older MCO over a newer profile. Thrown from
    // here it would reject the whenReady promise and the app would simply never
    // appear, so say what happened before quitting.
    try {
      getDb(); // open the database and run migrations before any IPC handler can fire
    } catch (err) {
      console.error('[db] cannot open the profile database:', err);
      dialog.showErrorBox(
        'MCO cannot start',
        err instanceof SchemaVersionError
          ? err.message
          : `MCO could not open its database.\n\n${err instanceof Error ? err.message : String(err)}`,
      );
      app.quit();
      return;
    }
    // MCO's UI needs no web-platform permissions — no camera, microphone,
    // geolocation, or the web Notification API (toasts are raised from the main
    // process). Refusing them all is simpler than auditing which are reachable.
    session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => {
      console.warn(`[security] denied a renderer permission request: ${permission}`);
      callback(false);
    });

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
