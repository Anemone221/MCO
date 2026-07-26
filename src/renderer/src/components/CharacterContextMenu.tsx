import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CharacterGroup, Tag } from '@shared/types';

const MENU_WIDTH = 200;
const SUBMENU_WIDTH = 200;
/** Minimum gap kept between the menu and every viewport edge. */
const VIEWPORT_MARGIN = 8;

/** What a checkbox submenu needs from a tag or group: id, name, color, members. */
interface MembershipItem {
  id: number;
  name: string;
  color: string | null;
  characterIds: number[];
}

/**
 * One top-level menu entry with a checkbox-list flyout (tags, groups). Owns its
 * hover-open state and flips the flyout upward when it would leave the viewport.
 */
function MembershipSubmenu({
  label,
  idPrefix,
  items,
  emptyText,
  characterId,
  busy,
  flipLeft,
  onToggle,
}: {
  label: string;
  /** data-testid prefix, e.g. 'tag' → `tag-submenu-…`, `tag-menu-item-…`. */
  idPrefix: string;
  items: MembershipItem[];
  emptyText: string;
  characterId: number;
  busy: boolean;
  /** Open the flyout to the left when the menu sits near the right edge. */
  flipLeft: boolean;
  onToggle: (itemId: number, assigned: boolean) => void;
}) {
  const submenuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false);

  // The flyout opens downward by default; flip it upward when its measured
  // extent would leave the viewport (right-click near the bottom).
  useLayoutEffect(() => {
    if (!open) {
      setUp(false);
      return;
    }
    const rect = submenuRef.current?.getBoundingClientRect();
    if (rect) setUp(rect.bottom > window.innerHeight - VIEWPORT_MARGIN);
  }, [open]);

  return (
    <div
      className="context-menu__group"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <div
        className="context-menu__item context-menu__item--parent"
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid={`${idPrefix}-parent-${characterId}`}
      >
        {label}
        <span className="context-menu__arrow">▸</span>
      </div>

      {open && (
        <div
          ref={submenuRef}
          className={[
            'context-menu__submenu',
            flipLeft ? 'context-menu__submenu--left' : '',
            up ? 'context-menu__submenu--up' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          role="menu"
          data-testid={`${idPrefix}-submenu-${characterId}`}
        >
          {items.length === 0 ? (
            <div className="context-menu__empty">{emptyText}</div>
          ) : (
            <div className="context-menu__list">
              {items.map((item) => {
                const assigned = item.characterIds.includes(characterId);
                return (
                  <label
                    key={item.id}
                    className="context-menu__item"
                    data-testid={`${idPrefix}-menu-item-${characterId}-${item.id}`}
                  >
                    <input
                      type="checkbox"
                      checked={assigned}
                      disabled={busy}
                      onChange={() => onToggle(item.id, assigned)}
                    />
                    <span
                      className="context-menu__dot"
                      style={{ background: item.color ?? 'var(--muted)' }}
                    />
                    {item.name}
                  </label>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Right-click context menu for a character anywhere one is listed (Roster
 * rows, fit/plan result lists). Top-level actions live here; tag assignment
 * and group membership are nested in submenus so more row actions can be
 * added later. Closes on Escape, outside click, or resize.
 */
export default function CharacterContextMenu({
  x,
  y,
  characterId,
  characterName,
  tags,
  groups,
  busy,
  onToggleTag,
  onToggleGroup,
  onClose,
}: {
  x: number;
  y: number;
  characterId: number;
  characterName: string;
  tags: Tag[];
  groups: CharacterGroup[];
  busy: boolean;
  onToggleTag: (tagId: number, assigned: boolean) => void;
  onToggleGroup: (groupId: number, member: boolean) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [menuHeight, setMenuHeight] = useState(0);

  // Measure the rendered menu so the vertical clamp uses its real height
  // (runs before paint, so the unclamped position is never visible).
  useLayoutEffect(() => {
    setMenuHeight(ref.current?.offsetHeight ?? 0);
  }, []);

  useEffect(() => {
    function onPointerDown(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose();
    }
    // Capture-phase so a click on another row closes this menu first.
    document.addEventListener('mousedown', onPointerDown, true);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('mousedown', onPointerDown, true);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  // Keep the menu (and its submenu flyouts) inside the viewport.
  const left = Math.max(
    VIEWPORT_MARGIN,
    Math.min(x, window.innerWidth - MENU_WIDTH - VIEWPORT_MARGIN),
  );
  const top = Math.max(
    VIEWPORT_MARGIN,
    Math.min(y, window.innerHeight - menuHeight - VIEWPORT_MARGIN),
  );
  const flipLeft = left + MENU_WIDTH + SUBMENU_WIDTH + VIEWPORT_MARGIN > window.innerWidth;

  return (
    <div
      ref={ref}
      className="context-menu"
      style={{ left, top, width: MENU_WIDTH }}
      role="menu"
      data-testid={`character-context-menu-${characterId}`}
    >
      <div className="context-menu__title">{characterName}</div>

      <MembershipSubmenu
        label="Assign tags"
        idPrefix="tag"
        items={tags}
        emptyText="No tags yet — create some on the Tags page."
        characterId={characterId}
        busy={busy}
        flipLeft={flipLeft}
        onToggle={onToggleTag}
      />
      <MembershipSubmenu
        label="Add to group"
        idPrefix="group"
        items={groups}
        emptyText="No groups yet — create some on the Groups page."
        characterId={characterId}
        busy={busy}
        flipLeft={flipLeft}
        onToggle={onToggleGroup}
      />
    </div>
  );
}
