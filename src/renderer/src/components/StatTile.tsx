import { type CSSProperties, type ReactNode } from 'react';

/**
 * Stat tile with the shared entrance stagger (index drives the delay), used by
 * the Dashboard's stat row and the Wallet page's month cards.
 *
 * `hint` is the detail that used to sit under the figure: what the category
 * counts, the sub-totals behind it, the caveats. A row of tiles is meant to be
 * read in one sweep, and a wrapped line of explanation under each one costs
 * more than it gives — so it moves to hover, the same native `title` the rest
 * of the app uses for on-demand detail. Newlines split it into lines.
 */
export default function StatTile({
  index,
  label,
  testId,
  hint,
  children,
}: {
  index: number;
  label: string;
  testId: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div
      className="dashboard-tile"
      style={{ '--tile-index': index } as CSSProperties}
      data-testid={testId}
      title={hint}
    >
      <div className="dashboard-tile__label">{label}</div>
      {children}
    </div>
  );
}
