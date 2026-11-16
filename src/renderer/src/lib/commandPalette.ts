/**
 * The quick-search palette's pure half: what can be jumped to, and how a query
 * ranks it. Kept dependency-free (no React, no IPC) so the matching rules are
 * unit-tested on their own; `components/CommandPalette.tsx` supplies the data
 * and the keyboard handling.
 */

export type PaletteKind = 'page' | 'character' | 'fit' | 'plan' | 'group' | 'action';

export interface PaletteItem {
  /** Unique across kinds, e.g. `character:2112345678`. */
  key: string;
  kind: PaletteKind;
  label: string;
  /** Secondary text shown dimmed and also searched (account, ship, …). */
  detail?: string;
  /** Route to open; absent for an action. */
  to?: string;
  /** Action id for the palette to run; absent for a route. */
  action?: PaletteAction;
}

export type PaletteAction = 'sync-all';

export interface PaletteSources {
  pages: Array<{ to: string; label: string }>;
  characters: Array<{ id: number; name: string; accountLabel: string | null }>;
  fits: Array<{ id: number; name: string; shipName: string }>;
  plans: Array<{ id: number; name: string }>;
  groups: Array<{ id: number; name: string; memberCount: number }>;
}

export const KIND_LABEL: Record<PaletteKind, string> = {
  page: 'Page',
  character: 'Character',
  fit: 'Fit',
  plan: 'Plan',
  group: 'Group',
  action: 'Action',
};

/** Ties in score break by kind in this order: places first, then people, then things. */
const KIND_ORDER: Record<PaletteKind, number> = {
  page: 0,
  action: 1,
  character: 2,
  group: 3,
  fit: 4,
  plan: 5,
};

/** Flatten every source into palette items. */
export function buildPaletteItems(sources: PaletteSources): PaletteItem[] {
  const items: PaletteItem[] = [];
  for (const p of sources.pages) {
    items.push({ key: `page:${p.to}`, kind: 'page', label: p.label, to: p.to });
  }
  items.push({
    key: 'action:sync-all',
    kind: 'action',
    label: 'Sync all characters',
    action: 'sync-all',
  });
  for (const c of sources.characters) {
    items.push({
      key: `character:${c.id}`,
      kind: 'character',
      label: c.name,
      detail: c.accountLabel ?? undefined,
      to: `/character/${c.id}`,
    });
  }
  for (const g of sources.groups) {
    items.push({
      key: `group:${g.id}`,
      kind: 'group',
      label: g.name,
      detail: `${g.memberCount} member${g.memberCount === 1 ? '' : 's'}`,
      to: `/groups/${g.id}`,
    });
  }
  for (const f of sources.fits) {
    items.push({ key: `fit:${f.id}`, kind: 'fit', label: f.name, detail: f.shipName, to: `/fits/${f.id}` });
  }
  for (const p of sources.plans) {
    items.push({ key: `plan:${p.id}`, kind: 'plan', label: p.name, to: `/plans/${p.id}` });
  }
  return items;
}

/**
 * How well `query` matches `text` (both already lower-cased); 0 = no match.
 * Prefix beats word-start beats substring beats in-order subsequence, so
 * "ven" finds "Venture" before "Raven", and "vnt" still finds "Venture".
 */
export function matchScore(text: string, query: string): number {
  if (query === '') return 1;
  if (text.startsWith(query)) return 100 - Math.min(text.length - query.length, 50) / 100;
  const at = text.indexOf(query);
  if (at > 0) {
    const wordStart = /[\s\-_/.(['"]/.test(text[at - 1] ?? '');
    return (wordStart ? 80 : 60) - Math.min(at, 50) / 100;
  }
  // Subsequence: every query character, in order.
  let ti = 0;
  for (const ch of query) {
    ti = text.indexOf(ch, ti);
    if (ti === -1) return 0;
    ti += 1;
  }
  return 20;
}

/**
 * Rank `items` against `query`; at most `limit` results. An empty query lists
 * the pages and actions only — 90+ characters would otherwise bury them.
 * The detail line counts too, at a discount, so an account label finds its
 * characters and a ship name finds its fits.
 */
export function searchPalette(items: PaletteItem[], query: string, limit = 50): PaletteItem[] {
  const q = query.trim().toLowerCase();
  if (q === '') {
    return items.filter((i) => i.kind === 'page' || i.kind === 'action').slice(0, limit);
  }
  const scored: Array<{ item: PaletteItem; score: number }> = [];
  for (const item of items) {
    const label = matchScore(item.label.toLowerCase(), q);
    const detail = item.detail ? matchScore(item.detail.toLowerCase(), q) * 0.5 : 0;
    const score = Math.max(label, detail);
    if (score > 0) scored.push({ item, score });
  }
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      KIND_ORDER[a.item.kind] - KIND_ORDER[b.item.kind] ||
      a.item.label.localeCompare(b.item.label),
  );
  return scored.slice(0, limit).map((s) => s.item);
}

/** Whether a keyboard event happened in a text field, where single-key shortcuts must not fire. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as { tagName?: unknown }).tagName !== 'string') return false;
  const el = target as unknown as { tagName: string; isContentEditable?: boolean; type?: string };
  const tag = el.tagName.toLowerCase();
  if (el.isContentEditable === true) return true;
  if (tag === 'textarea' || tag === 'select') return true;
  if (tag !== 'input') return false;
  const type = (el.type ?? 'text').toLowerCase();
  return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file'].includes(type);
}
