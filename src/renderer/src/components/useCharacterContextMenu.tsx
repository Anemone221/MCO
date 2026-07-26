import { useState, type MouseEvent, type ReactNode } from 'react';
import type { CharacterGroup, Tag } from '@shared/types';
import { mco } from '../lib/ipc';
import CharacterContextMenu from './CharacterContextMenu';

interface MenuState {
  x: number;
  y: number;
  characterId: number;
  characterName: string;
}

/**
 * Right-click tag/group assignment for any page that lists characters (fit and
 * plan results). Owns the menu state and the membership IPC calls; the page
 * supplies its loaded tag/group lists and refreshes them via `onChanged` after
 * every toggle. Attach `openMenu` to a row's onContextMenu and render
 * `menuElement` at the end of the page.
 *
 * (The Roster wires the menu itself: its toggles share the page-wide `run`
 * helper that also services account moves and row pinning.)
 */
export function useCharacterContextMenu({
  tags,
  groups,
  onChanged,
  onError,
}: {
  tags: Tag[];
  groups: CharacterGroup[];
  /** Called after each successful toggle so the page can reload tags/groups. */
  onChanged: () => void | Promise<void>;
  onError?: (message: string) => void;
}): {
  openMenu: (event: MouseEvent, characterId: number, characterName: string) => void;
  menuElement: ReactNode;
} {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [busy, setBusy] = useState(false);

  function openMenu(event: MouseEvent, characterId: number, characterName: string): void {
    event.preventDefault();
    setMenu({ x: event.clientX, y: event.clientY, characterId, characterName });
  }

  async function toggle(action: () => Promise<void>): Promise<void> {
    setBusy(true);
    try {
      await action();
      await onChanged();
    } catch (e) {
      onError?.(String(e));
    } finally {
      setBusy(false);
    }
  }

  const menuElement = menu ? (
    <CharacterContextMenu
      x={menu.x}
      y={menu.y}
      characterId={menu.characterId}
      characterName={menu.characterName}
      tags={tags}
      groups={groups}
      busy={busy}
      onToggleTag={(tagId, assigned) =>
        void toggle(() =>
          assigned
            ? mco.tags.removeMember(tagId, menu.characterId)
            : mco.tags.addMember(tagId, menu.characterId),
        )
      }
      onToggleGroup={(groupId, member) =>
        void toggle(() =>
          member
            ? mco.groups.removeMember(groupId, menu.characterId)
            : mco.groups.addMember(groupId, menu.characterId),
        )
      }
      onClose={() => setMenu(null)}
    />
  ) : null;

  return { openMenu, menuElement };
}
