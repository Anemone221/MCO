import { app, type BrowserWindow } from 'electron';
import { unhandledChannels } from './coverage';
import { registeredChannels } from './handle';
import { registerAccountChannels } from './channels/accounts';
import { registerBlueprintChannels } from './channels/blueprints';
import { registerBoardChannels } from './channels/boards';
import { registerCharacterChannels } from './channels/characters';
import { registerFitChannels } from './channels/fits';
import { registerGroupChannels } from './channels/groups';
import { registerNotificationChannels } from './channels/notifications';
import { registerPlanChannels } from './channels/plans';
import { registerSdeChannels } from './channels/sde';
import { registerSettingsChannels } from './channels/settings';
import { registerSystemChannels } from './channels/system';
import { registerTagChannels } from './channels/tags';
import { registerUniverseChannels } from './channels/universe';

/**
 * Wire every renderer-facing IPC channel to its main-process handler.
 *
 * The wiring itself lives in `./channels/`, one module per domain — the same
 * domains `McoApi` is already grouped by in `shared/ipc.ts`. A channel costs
 * four edits (the channel table, `McoApi`, preload, a handler); this is the one
 * that used to mean editing the middle of a 300-line function behind an 80-line
 * import header, and now means editing one small file, or adding one.
 *
 * Registrars take `getWindow` only if they push to the renderer or parent a
 * native dialog, so the signature says which domains reach the window at all.
 */
export function registerIpc(getWindow: () => BrowserWindow | null): void {
  registerCharacterChannels();
  registerAccountChannels();
  registerGroupChannels();
  registerTagChannels();
  registerSdeChannels(getWindow);
  registerFitChannels();
  registerPlanChannels();
  registerUniverseChannels(getWindow);
  registerBlueprintChannels();
  registerBoardChannels();
  registerNotificationChannels();
  registerSystemChannels(getWindow);
  registerSettingsChannels(getWindow);

  // A registrar that is declared but never called above wires nothing, and the
  // symptom is a page failing on invoke with "No handler registered" — far from
  // the cause. Unpackaged (dev, E2E) that is a developer mistake worth stopping
  // for; in a shipped build one broken page beats refusing to start.
  const missing = unhandledChannels(registeredChannels());
  if (missing.length > 0) {
    const message = `IPC channels declared with no handler: ${missing.join(', ')}`;
    if (!app.isPackaged) throw new Error(message);
    console.error(`[ipc] ${message}`);
  }
}
