import { describe, expect, it } from 'vitest';
import { IPC_EVENT_CHANNELS, IpcChannel } from '@shared/ipc';
import { invokeChannels, unhandledChannels } from '@main/ipc/coverage';

describe('invokeChannels', () => {
  it('is every declared channel except the push-only ones', () => {
    const invoke = invokeChannels();

    expect(invoke).toHaveLength(Object.values(IpcChannel).length - IPC_EVENT_CHANNELS.length);
    for (const event of IPC_EVENT_CHANNELS) expect(invoke).not.toContain(event);
    expect(invoke).toContain(IpcChannel.charactersRoster);
  });
});

describe('IPC_EVENT_CHANNELS', () => {
  it('only names channels that exist', () => {
    // A renamed channel would otherwise leave a stale entry here, which reads as
    // "this one needs no handler" and hides exactly what the check is for.
    const declared = new Set<string>(Object.values(IpcChannel));
    for (const event of IPC_EVENT_CHANNELS) expect(declared.has(event)).toBe(true);
  });
});

describe('unhandledChannels', () => {
  it('reports nothing when every invoke channel is wired', () => {
    expect(unhandledChannels(invokeChannels())).toEqual([]);
  });

  it('reports the channels a missing registrar would have wired', () => {
    const withoutTags = invokeChannels().filter(
      (channel) => !channel.startsWith('tags:'),
    );

    const missing = unhandledChannels(withoutTags);

    expect(missing).toContain(IpcChannel.tagsList);
    expect(missing).toContain(IpcChannel.tagsAddMembers);
    expect(missing).not.toContain(IpcChannel.charactersRoster);
  });

  it('does not ask for handlers on push-only channels', () => {
    // Registering nothing at all: the only channels reported are invoke ones.
    const missing = unhandledChannels([]);

    for (const event of IPC_EVENT_CHANNELS) expect(missing).not.toContain(event);
    expect(missing).toHaveLength(invokeChannels().length);
  });
});
