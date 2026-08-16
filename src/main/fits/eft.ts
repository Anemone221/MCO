/**
 * Parser for pyfa's EFT fitting format.
 *
 * Example:
 *   [Hurricane, My Hurricane]
 *   Damage Control II
 *
 *   425mm AutoCannon II, Republic Fleet EMP M
 *
 *   Hobgoblin II x5
 *   Nanite Repair Paste x50
 */

import { UserFacingError } from '../errors';

export type EftItemKind = 'module' | 'charge' | 'quantity';

export interface EftItem {
  name: string;
  quantity: number;
  /** 'module'/'charge' = fitted; 'quantity' = an `xN` line (drone or cargo). */
  kind: EftItemKind;
}

export interface ParsedFit {
  shipName: string;
  fitName: string;
  items: EftItem[];
}

/** SDE category ids of `xN` items whose skills count toward flying the fit. */
const MODULE_CATEGORY_ID = 7;
const CHARGE_CATEGORY_ID = 8;
const DRONE_CATEGORY_ID = 18;
const COUNTED_QUANTITY_CATEGORIES = new Set([
  MODULE_CATEGORY_ID,
  CHARGE_CATEGORY_ID,
  DRONE_CATEGORY_ID,
]);

/**
 * Whether an item's skill requirements count toward flying the fit. Fitted
 * items (module/charge lines) always count. `xN` items count when they are
 * drones or usable spares — charges (e.g. swappable mining crystals) and
 * modules carried in cargo. Inert cargo (ore, paste, deployables) does not.
 */
export function countsForSkills(kind: EftItemKind, categoryId: number | undefined): boolean {
  if (kind !== 'quantity') return true;
  return categoryId !== undefined && COUNTED_QUANTITY_CATEGORIES.has(categoryId);
}

const HEADER = /^\[(.+?),\s*(.+)\]$/;
const EMPTY_SLOT = /^\[.*\]$/;
const OFFLINE_SUFFIX = /\s*\/(OFFLINE|ON)\s*$/i;
const QUANTITY_SUFFIX = /^(.*?)\s+x(\d+)$/;

/** Parse an EFT fit block into its ship and a flat list of items. */
export function parseEft(text: string): ParsedFit {
  const lines = text.split(/\r?\n/);
  const firstIndex = lines.findIndex((line) => line.trim().length > 0);
  if (firstIndex === -1) throw new UserFacingError('Empty fit text');

  const headerMatch = HEADER.exec(lines[firstIndex]!.trim());
  if (!headerMatch) {
    throw new UserFacingError('Not a valid EFT fit — the first line must be "[Ship, Fit name]"');
  }
  const shipName = headerMatch[1]!.trim();
  const fitName = headerMatch[2]!.trim();

  const items: EftItem[] = [];
  for (const raw of lines.slice(firstIndex + 1)) {
    let line = raw.trim();
    if (line.length === 0) continue;
    if (EMPTY_SLOT.test(line)) continue; // e.g. "[Empty High slot]"

    line = line.replace(OFFLINE_SUFFIX, '').trim();
    if (line.length === 0) continue;

    const quantityMatch = QUANTITY_SUFFIX.exec(line);
    if (quantityMatch) {
      items.push({
        name: quantityMatch[1]!.trim(),
        quantity: Number(quantityMatch[2]),
        kind: 'quantity',
      });
      continue;
    }

    const commaIndex = line.indexOf(', ');
    if (commaIndex !== -1) {
      items.push({ name: line.slice(0, commaIndex).trim(), quantity: 1, kind: 'module' });
      items.push({ name: line.slice(commaIndex + 2).trim(), quantity: 1, kind: 'charge' });
      continue;
    }

    items.push({ name: line, quantity: 1, kind: 'module' });
  }

  return { shipName, fitName, items };
}
