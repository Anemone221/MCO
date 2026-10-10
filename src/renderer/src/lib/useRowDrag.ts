/**
 * Drag-to-reorder for the plan creator's queue, on pointer events rather than
 * HTML5 drag and drop.
 *
 * HTML5 DnD made the whole row a drag handle, and Chromium fires no click
 * after a drag — so a click that drifted a few pixels (most of them, on a row
 * this short) never revealed its skill. Here a press only becomes a drag once
 * it has moved past a small threshold, so a click stays a click and the whole
 * row can be grabbed. It also gives what DnD couldn't do cleanly: a drop line
 * *between* rows (including either side of a remap point), auto-scroll near
 * the list's edges, and Escape to cancel.
 *
 * Rows opt in through data attributes: `data-drag-row={index}` on a skill row
 * (plus `data-has-remap` when a remap sits above it), `data-drag-remap={index}`
 * on the remap row above skill row `index`.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';
import type { DropTarget } from './planDraft';

/** How far a press must travel before it is a drag rather than a click. */
const DRAG_THRESHOLD = 5;
/** How close to the list's top or bottom edge the pointer must be to scroll it. */
const SCROLL_EDGE = 36;
/** Fastest auto-scroll, in pixels per frame, reached right at the edge. */
const SCROLL_SPEED = 14;

export interface RowDrag {
  /** The row being dragged and where it would land; null when no drag is active. */
  active: { from: number; target: DropTarget | null } | null;
  /** Wire to each skill row's `onPointerDown`. */
  onRowPointerDown: (index: number, event: ReactPointerEvent<HTMLElement>) => void;
  /** True once, right after a drag ends — the row's click handler should skip it. */
  consumeClick: () => boolean;
}

/**
 * Where the pointer at height `y` would drop, read off the row under it. Only
 * the height matters: the hit test runs down the middle of the list, so
 * straying sideways out of the table keeps tracking rows.
 */
function targetAt(container: HTMLElement, y: number, count: number): DropTarget | null {
  const rows = container.querySelectorAll<HTMLElement>('[data-drag-row], [data-drag-remap]');
  if (rows.length === 0) return null;

  // Past either end of the list: the very top or the very end.
  if (y < rows[0]!.getBoundingClientRect().top) return { index: 0, underRemap: false };
  if (y > rows[rows.length - 1]!.getBoundingClientRect().bottom) {
    return { index: count, underRemap: false };
  }

  const box = container.getBoundingClientRect();
  const element = document
    .elementFromPoint(box.left + box.width / 2, y)
    ?.closest<HTMLElement>('[data-drag-row], [data-drag-remap]');
  if (!element || !container.contains(element)) return null;

  const rect = element.getBoundingClientRect();
  const upper = y < rect.top + rect.height / 2;
  if (element.dataset.dragRemap !== undefined) {
    // The remap row above skill row i: above it, or between it and its row.
    return { index: Number(element.dataset.dragRemap), underRemap: !upper };
  }
  const index = Number(element.dataset.dragRow);
  return upper
    ? { index, underRemap: element.hasAttribute('data-has-remap') }
    : { index: index + 1, underRemap: false };
}

export function useRowDrag(
  containerRef: RefObject<HTMLElement | null>,
  count: number,
  onDrop: (from: number, target: DropTarget) => void,
): RowDrag {
  const [active, setActive] = useState<RowDrag['active']>(null);

  // Latest values for the window listeners, which outlive any one render.
  const countRef = useRef(count);
  const onDropRef = useRef(onDrop);
  useEffect(() => {
    countRef.current = count;
    onDropRef.current = onDrop;
  });

  const suppressClick = useRef(false);
  const cleanup = useRef<(() => void) | null>(null);

  // A drag in progress when the page unmounts must not leave listeners behind.
  useEffect(() => () => cleanup.current?.(), []);

  const onRowPointerDown = useCallback(
    (index: number, event: ReactPointerEvent<HTMLElement>) => {
      suppressClick.current = false;
      if (event.button !== 0) return;
      // The row's own controls keep their own behaviour.
      if ((event.target as HTMLElement).closest('button, input, select, textarea, a')) return;
      const container = containerRef.current;
      if (!container) return;

      cleanup.current?.();

      const startX = event.clientX;
      const startY = event.clientY;
      let pointer = { x: startX, y: startY };
      let dragging = false;
      let target: DropTarget | null = null;
      let frame = 0;

      const update = (): void => {
        target = targetAt(container, pointer.y, countRef.current) ?? target;
        setActive({ from: index, target });
      };

      // Scroll while the pointer rests near an edge, faster the closer it is.
      const scrollLoop = (): void => {
        const box = container.getBoundingClientRect();
        const fromTop = pointer.y - box.top;
        const fromBottom = box.bottom - pointer.y;
        let delta = 0;
        if (fromTop < SCROLL_EDGE) delta = -SCROLL_SPEED * (1 - Math.max(0, fromTop) / SCROLL_EDGE);
        else if (fromBottom < SCROLL_EDGE) {
          delta = SCROLL_SPEED * (1 - Math.max(0, fromBottom) / SCROLL_EDGE);
        }
        if (delta !== 0) {
          container.scrollTop += delta;
          update();
        }
        frame = window.requestAnimationFrame(scrollLoop);
      };

      const finish = (drop: boolean): void => {
        const wasDragging = dragging;
        const landed = target;
        cleanup.current?.();
        if (!wasDragging) return;
        suppressClick.current = true;
        setActive(null);
        if (drop && landed) onDropRef.current(index, landed);
      };

      const onMove = (e: PointerEvent): void => {
        pointer = { x: e.clientX, y: e.clientY };
        if (!dragging) {
          if (Math.hypot(e.clientX - startX, e.clientY - startY) < DRAG_THRESHOLD) return;
          dragging = true;
          document.body.classList.add('is-row-dragging');
          frame = window.requestAnimationFrame(scrollLoop);
        }
        update();
      };
      const onUp = (): void => finish(true);
      const onCancel = (): void => finish(false);
      const onKey = (e: KeyboardEvent): void => {
        if (e.key !== 'Escape') return;
        e.preventDefault();
        finish(false);
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onCancel);
      window.addEventListener('keydown', onKey);
      cleanup.current = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onCancel);
        window.removeEventListener('keydown', onKey);
        window.cancelAnimationFrame(frame);
        document.body.classList.remove('is-row-dragging');
        cleanup.current = null;
        setActive(null);
      };
    },
    [containerRef],
  );

  const consumeClick = useCallback((): boolean => {
    if (!suppressClick.current) return false;
    suppressClick.current = false;
    return true;
  }, []);

  return { active, onRowPointerDown, consumeClick };
}
