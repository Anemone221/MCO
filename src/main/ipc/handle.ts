import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import type { IpcChannelName } from '@shared/ipc';
import { toUserMessage } from '../errors';

/** Every channel wired this run, in registration order — read by the coverage check. */
const registered: IpcChannelName[] = [];

export function registeredChannels(): readonly IpcChannelName[] {
  return registered;
}

/**
 * Register one channel, with the shared error boundary around its handler.
 *
 * A rejected `invoke` is rendered by whichever page called it, so a handler that
 * throws would otherwise put a developer-facing message on screen — a record id,
 * an ESI response body, SQL text from a constraint failure. Instead the real
 * error goes to the captured log (Settings → Export logs) tagged with its
 * channel, and the renderer gets the normalized message from `toUserMessage`.
 *
 * Every domain registrar under `ipc/channels/` goes through here; nothing calls
 * `ipcMain.handle` directly, which is what keeps the boundary universal.
 */
export function handle<Args extends unknown[], R>(
  channel: IpcChannelName,
  handler: (event: IpcMainInvokeEvent, ...args: Args) => R | Promise<R>,
): void {
  registered.push(channel);
  ipcMain.handle(channel, async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
    try {
      // IPC arguments are untyped on the wire; McoApi in shared/ipc.ts is what
      // keeps the renderer's call and this handler's signature in agreement.
      return await handler(event, ...(args as Args));
    } catch (err) {
      console.error(`[ipc] ${channel} failed:`, err);
      throw new Error(toUserMessage(err));
    }
  });
}
