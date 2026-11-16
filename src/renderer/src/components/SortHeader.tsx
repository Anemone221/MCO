import type { ReactNode } from 'react';

/**
 * A sortable column header. The click target is a real `<button>` inside the
 * `<th>`, so the column can be reached with Tab and sorted with Enter or Space
 * — a bare clickable `<th>` can't be focused. `aria-sort` stays on the `<th>`,
 * where screen readers look for it.
 */
export default function SortHeader({
  label,
  active,
  dir,
  onSort,
  numeric = false,
  className,
  title,
  testId,
}: {
  label: ReactNode;
  /** This column is the current sort key. */
  active: boolean;
  dir: 'asc' | 'desc';
  onSort: () => void;
  numeric?: boolean;
  /** Extra classes for the `<th>`. */
  className?: string;
  title?: string;
  testId?: string;
}) {
  const classes = ['sortable', numeric ? 'num' : null, className ?? null].filter(Boolean).join(' ');
  return (
    <th
      className={classes}
      title={title}
      aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}
      data-testid={testId}
    >
      <button type="button" className="sort-button" onClick={onSort}>
        {label}
        {active && <span className="sort-arrow">{dir === 'asc' ? '▲' : '▼'}</span>}
      </button>
    </th>
  );
}
