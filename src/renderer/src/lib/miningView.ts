import type { MiningSummary } from '@shared/types';
import { formatVolume } from './format';

/**
 * What the Mining page's table shows, and in what order. Pure and
 * dependency-free (same shape as `rosterView.ts` / `blueprintView.ts`) so the
 * rules behind the one table that serves three different breakdowns can be
 * tested without rendering anything.
 *
 * The three breakdowns — who mined, what they mined, where they mined it — are
 * the same aggregate cut three ways, so they collapse into one row shape and
 * one table rather than three near-identical ones. Only the column headers and
 * which of the optional columns appear differ.
 */

export type MiningBreakdown = 'character' | 'ore' | 'system';

export const MINING_BREAKDOWNS: Array<{ id: MiningBreakdown; label: string }> = [
  { id: 'character', label: 'Character' },
  { id: 'ore', label: 'Ore type' },
  { id: 'system', label: 'System' },
];

export type MiningSortKey = 'label' | 'sublabel' | 'volume' | 'units' | 'countA' | 'countB' | 'extra';

export interface MiningSort {
  key: MiningSortKey;
  dir: 'asc' | 'desc';
}

/** Biggest hauls first — the question the page is usually opened to answer. */
export const DEFAULT_MINING_SORT: MiningSort = { key: 'volume', dir: 'desc' };

/** A value that renders as text but sorts as a number (a day, an m³-per-unit figure). */
export interface SortableCell {
  text: string;
  sort: number;
}

/** One table row, whichever breakdown produced it. */
export interface MiningViewRow {
  key: string;
  label: string;
  sublabel: string | null;
  /** Set on character rows: the row links to the sheet and takes the tag menu. */
  characterId: number | null;
  /** Set on ore rows, for the type icon. */
  typeId: number | null;
  /** Set on system rows, for the security colour. */
  security: number | null;
  units: number;
  volumeM3: number;
  countA: number | null;
  countB: number | null;
  extra: SortableCell | null;
}

export interface MiningColumn {
  key: MiningSortKey;
  label: string;
  numeric?: boolean;
  /** Hover text — the column headers are terse by design. */
  title?: string;
}

const VOLUME_COLUMN: MiningColumn = {
  key: 'volume',
  label: 'Volume',
  numeric: true,
  title: 'Units × the SDE volume of one unit',
};

const UNITS_COLUMN: MiningColumn = {
  key: 'units',
  label: 'Units',
  numeric: true,
  title: 'What ESI counts: units of ore, ice or gas',
};

/**
 * The columns each breakdown shows, in order. Every breakdown keeps the two
 * measured columns in the same place, so switching breakdown doesn't move the
 * numbers the eye is tracking.
 *
 * In the units fallback (an SDE with no volumes) the volume column is dropped
 * rather than filled with the unit count — two columns of the same number,
 * one of them mislabelled, is worse than one honest column.
 */
export function miningColumns(
  breakdown: MiningBreakdown,
  metric: 'volume' | 'units' = 'volume',
): MiningColumn[] {
  const measured = metric === 'units' ? [UNITS_COLUMN] : [VOLUME_COLUMN, UNITS_COLUMN];
  if (breakdown === 'character') {
    return [
      { key: 'label', label: 'Character' },
      { key: 'sublabel', label: 'Account' },
      ...measured,
      { key: 'countA', label: 'Ores', numeric: true, title: 'Distinct ore types mined' },
      { key: 'countB', label: 'Systems', numeric: true, title: 'Distinct systems mined in' },
      { key: 'extra', label: 'Last mined' },
    ];
  }
  if (breakdown === 'ore') {
    return [
      { key: 'label', label: 'Ore' },
      { key: 'sublabel', label: 'Group' },
      ...measured,
      { key: 'countA', label: 'Miners', numeric: true, title: 'Characters that mined it' },
      { key: 'extra', label: 'm³ / unit', numeric: true },
    ];
  }
  return [
    { key: 'label', label: 'System' },
    { key: 'sublabel', label: 'Region' },
    ...measured,
    { key: 'countA', label: 'Miners', numeric: true, title: 'Characters that mined there' },
  ];
}

/** Which column carries the share bar: the one the page is measuring in. */
export function barColumn(metric: 'volume' | 'units'): MiningSortKey {
  return metric === 'units' ? 'units' : 'volume';
}

/** A YYYY-MM-DD day as a sortable number (20260820), so string days order as dates. */
function daySort(day: string | null): number {
  return day === null ? 0 : Number(day.replace(/-/g, ''));
}

/** The summary's rows for one breakdown, in the shape the table renders. */
export function miningRows(summary: MiningSummary, breakdown: MiningBreakdown): MiningViewRow[] {
  if (breakdown === 'character') {
    return summary.byCharacter.map((row) => ({
      key: `character:${row.characterId}`,
      label: row.characterName,
      sublabel: row.accountLabel,
      characterId: row.characterId,
      typeId: null,
      security: null,
      units: row.units,
      volumeM3: row.volumeM3,
      countA: row.oreTypes,
      countB: row.systems,
      extra: row.lastMinedDay === null
        ? null
        : { text: row.lastMinedDay, sort: daySort(row.lastMinedDay) },
    }));
  }

  if (breakdown === 'ore') {
    return summary.byOre.map((row) => ({
      key: `ore:${row.typeId}`,
      label: row.typeName ?? `Type ${row.typeId}`,
      sublabel: row.groupName,
      characterId: null,
      typeId: row.typeId,
      security: null,
      units: row.units,
      volumeM3: row.volumeM3,
      countA: row.characters,
      countB: null,
      // No volume in the SDE is not "0 m³ per unit" — it is the reason this
      // ore's m³ column reads 0, so it says so rather than showing a figure.
      extra:
        row.unitVolumeM3 === null
          ? { text: '—', sort: -1 }
          : { text: String(row.unitVolumeM3), sort: row.unitVolumeM3 },
    }));
  }

  return summary.bySystem.map((row) => ({
    key: `system:${row.solarSystemId}`,
    label: row.systemName ?? `System ${row.solarSystemId}`,
    sublabel: row.regionName,
    characterId: null,
    typeId: null,
    security: row.security,
    units: row.units,
    volumeM3: row.volumeM3,
    countA: row.characters,
    countB: null,
    extra: null,
  }));
}

/** Free-text filter over the two name columns — the only text a row carries. */
export function filterMiningRows(rows: MiningViewRow[], search: string): MiningViewRow[] {
  const needle = search.trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter((row) =>
    `${row.label}\n${row.sublabel ?? ''}`.toLowerCase().includes(needle),
  );
}

function sortValue(row: MiningViewRow, key: MiningSortKey): string | number {
  switch (key) {
    case 'label':
      return row.label.toLowerCase();
    case 'sublabel':
      return (row.sublabel ?? '').toLowerCase();
    case 'units':
      return row.units;
    case 'countA':
      return row.countA ?? 0;
    case 'countB':
      return row.countB ?? 0;
    case 'extra':
      return row.extra?.sort ?? 0;
    default:
      return row.volumeM3;
  }
}

/**
 * Sort a copy of the rows. Ties fall back to volume descending, so the rows
 * under a coarse key (an account, an ore group) still read biggest-first
 * instead of in whatever order the aggregate happened to return.
 */
export function sortMiningRows(rows: MiningViewRow[], sort: MiningSort): MiningViewRow[] {
  const direction = sort.dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const left = sortValue(a, sort.key);
    const right = sortValue(b, sort.key);
    if (left !== right) {
      const compared =
        typeof left === 'string' && typeof right === 'string'
          ? left.localeCompare(right)
          : Number(left) - Number(right);
      return compared * direction;
    }
    return b.volumeM3 - a.volumeM3;
  });
}

/** The sort a column starts at: names read A→Z, every number reads biggest-first. */
export function nextMiningSort(sort: MiningSort, key: MiningSortKey): MiningSort {
  if (sort.key === key) return { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' };
  return { key, dir: key === 'label' || key === 'sublabel' ? 'asc' : 'desc' };
}

/**
 * Which number the page should show and chart: m³ normally, units when the
 * imported SDE knows no volume for anything mined (an old import — every m³
 * figure would be 0). Reporting units is not as useful, but it is true.
 */
export function miningMetric(summary: MiningSummary): 'volume' | 'units' {
  return summary.totals.volumeM3 === 0 && summary.totals.units > 0 ? 'units' : 'volume';
}

/** The value the in-cell share bar is drawn from, matching {@link miningMetric}. */
export function barValue(row: MiningViewRow, metric: 'volume' | 'units'): number {
  return metric === 'units' ? row.units : row.volumeM3;
}

/** One figure in whichever unit the page is reading in, abbreviated. */
export function formatMiningValue(metric: 'volume' | 'units', value: number): string {
  return metric === 'units' ? `${value.toLocaleString()} units` : formatVolume(value);
}

/** Share of the largest row, 0-100 — the bar behind a row's headline number. */
export function barPercent(value: number, max: number): number {
  if (max <= 0) return 0;
  return Math.max(0, Math.min(100, (value / max) * 100));
}
