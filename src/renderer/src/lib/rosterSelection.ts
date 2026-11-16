/**
 * Row selection for the Roster's bulk actions. Pure: the page holds the set
 * and the anchor, these decide what a click does to them.
 *
 * "Visible" always means the rows on screen, in screen order — the roster
 * after filters and sorting — because that is what a shift-click range and the
 * header checkbox are read against.
 */

/** What the header checkbox shows for the rows on screen. */
export type HeaderSelection = 'none' | 'some' | 'all';

/**
 * A click on one row's checkbox. A plain click flips that row. A shift-click
 * gives every row from the anchor (the last row clicked) to this one the state
 * this row is switching to, so a range can be selected or cleared in one go.
 * With no anchor on screen, a shift-click is a plain click.
 */
export function clickSelection(
  selected: ReadonlySet<number>,
  visibleIds: readonly number[],
  id: number,
  anchor: number | null,
  shift: boolean,
): Set<number> {
  const next = new Set(selected);
  const turnOn = !selected.has(id);
  const from = shift && anchor !== null ? visibleIds.indexOf(anchor) : -1;
  const to = visibleIds.indexOf(id);
  const range =
    from === -1 || to === -1 ? [id] : visibleIds.slice(Math.min(from, to), Math.max(from, to) + 1);
  for (const rowId of range) {
    if (turnOn) next.add(rowId);
    else next.delete(rowId);
  }
  return next;
}

export function headerSelection(
  selected: ReadonlySet<number>,
  visibleIds: readonly number[],
): HeaderSelection {
  let held = 0;
  for (const id of visibleIds) if (selected.has(id)) held++;
  if (held === 0) return 'none';
  return held === visibleIds.length ? 'all' : 'some';
}

/**
 * The header checkbox: select every row on screen, or — when they all already
 * are — clear them. Rows selected earlier and since filtered away are left as
 * they were either way.
 */
export function toggleAllVisible(
  selected: ReadonlySet<number>,
  visibleIds: readonly number[],
): Set<number> {
  const next = new Set(selected);
  const clear = headerSelection(selected, visibleIds) === 'all';
  for (const id of visibleIds) {
    if (clear) next.delete(id);
    else next.add(id);
  }
  return next;
}

/**
 * The selection a bulk action applies to: the selected ids that still exist,
 * in roster order, and how many of them the current filters hide. A character
 * removed since it was ticked drops out here rather than reaching the main
 * process.
 */
export function resolveSelection(
  selected: ReadonlySet<number>,
  rosterIds: readonly number[],
  visibleIds: readonly number[],
): { ids: number[]; hidden: number } {
  const ids = rosterIds.filter((id) => selected.has(id));
  const onScreen = new Set(visibleIds);
  return { ids, hidden: ids.filter((id) => !onScreen.has(id)).length };
}
