import { IPC_EVENT_CHANNELS, IpcChannel, type IpcChannelName } from '@shared/ipc';

/**
 * Which channels the renderer can `invoke`: every declared channel except the
 * push-only ones the main process sends on.
 */
export function invokeChannels(): IpcChannelName[] {
  const events = new Set<IpcChannelName>(IPC_EVENT_CHANNELS);
  return Object.values(IpcChannel).filter((channel) => !events.has(channel));
}

/**
 * Declared invoke channels that nothing wired a handler for.
 *
 * The wiring is split across per-domain registrars, so the way to break it is no
 * longer a typo — it's a registrar that was never called, or a channel added to
 * the table and preload but not to its domain file. Either way the mistake is
 * invisible until a page invokes the channel and Electron answers "No handler
 * registered", which surfaces as a failed page rather than as a wiring bug.
 * Pure, so the arithmetic is testable without Electron.
 */
export function unhandledChannels(registered: Iterable<IpcChannelName>): IpcChannelName[] {
  const handled = new Set<IpcChannelName>(registered);
  return invokeChannels().filter((channel) => !handled.has(channel));
}
