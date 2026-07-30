import { app, BrowserWindow, nativeImage, shell, type Tray } from 'electron';
import { join } from 'node:path';
import appIconPath from '../../resources/icon.png?asset';
import { closeDb, getDb } from './db';
import { initLogCapture } from './log';
import { registerIpc } from './ipc/register';
import { isBackgroundLaunch } from './launchMode';
import { createBackgroundTray } from './tray';
import { runSweepNow, startScheduler, stopScheduler } from './services/scheduler';

// Capture console output from the very start so "Export logs" sees everything.
initLogCapture();

// Required for Windows toast notifications to display reliably under the nsis
// build target, which (unlike Squirrel) does not auto-register the AUMID.
app.setAppUserModelId('com.anemone221.mco');

/** Tray-only background sync runner mode (no window unless promoted). */
const backgroundMode = isBackgroundLaunch(process.argv);

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

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
    registerIpc(() => mainWindow); // both modes — the promoted window needs IPC
    startScheduler(() => mainWindow);
    if (backgroundMode) {
      tray = createBackgroundTray({
        onOpen: openMainWindow,
        onRunSync: () => void runSweepNow(),
      });
    } else {
      createWindow();
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  // In background mode, closing a promoted window drops back to tray-only sync.
  if (!backgroundMode && process.platform !== 'darwin') app.quit();
});

app.on('quit', () => {
  tray?.destroy();
  stopScheduler();
  closeDb();
});
