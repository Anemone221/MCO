import * as am5 from '@amcharts/amcharts5';
import * as am5xy from '@amcharts/amcharts5/xy';
import type { WalletDayTotals } from '@shared/types';
import { formatIsk } from '../../lib/format';
import { useAmChart, type ChartPalette } from './useAmChart';

interface ChartDatum {
  /** Day-of-month category label ("1".."31"). */
  day: string;
  missionIsk: number;
  bountyIsk: number;
  corpRewardIsk: number;
  /** Pre-formatted tooltip lines — amCharts' own formatter never sees ISK. */
  missionLabel: string;
  bountyLabel: string;
  corpRewardLabel: string;
  totalLabel: string;
}

/**
 * Every income category `IncomeSummary` tracks, in stacking order, so a day's
 * column sums to exactly what the Income tile counts for the month.
 *
 * The order is forced by the palette, not by preference: `--ok` (green) and
 * `--warn` (amber) are only ΔE 5.1 apart under protanopia, so they must never
 * be adjacent segments. Putting bounties (blue) between them clears both pairs
 * (worst adjacent ΔE 30.8 deutan). Bounties keep `--accent` and reward payouts
 * keep `--ok` to match the same categories on the previous-months chart —
 * color follows the category, not its position.
 */
const SERIES = [
  { name: 'Missions', value: 'missionIsk', label: 'missionLabel', color: 'warn' },
  { name: 'Bounties', value: 'bountyIsk', label: 'bountyLabel', color: 'accent' },
  { name: 'Reward payouts', value: 'corpRewardIsk', label: 'corpRewardLabel', color: 'ok' },
] as const satisfies readonly {
  name: string;
  value: keyof ChartDatum;
  label: keyof ChartDatum;
  color: keyof ChartPalette;
}[];

/**
 * Stacked columns of the current month's income, one column per UTC day:
 * mission rewards, NPC/ESS bounties and CONCORD reward payouts. Outgoings are
 * deliberately absent — a seven-class stack over 31 columns pushes past the
 * ~7-class limit where adjacent classes blur, so tax, expenses and donations
 * stay on the monthly chart where 12 columns can carry them. Chart lifecycle,
 * theming, and animation come from useAmChart.
 */
export default function IncomeByDayChart({ series }: { series: WalletDayTotals[] }) {
  const data: ChartDatum[] = series.map((entry) => ({
    day: String(Number(entry.day.slice(8, 10))),
    missionIsk: entry.income.missionIsk,
    bountyIsk: entry.income.bountyIsk,
    corpRewardIsk: entry.income.corpRewardIsk,
    missionLabel: formatIsk(entry.income.missionIsk),
    bountyLabel: formatIsk(entry.income.bountyIsk),
    corpRewardLabel: formatIsk(entry.income.corpRewardIsk),
    totalLabel: formatIsk(entry.income.totalIsk),
  }));

  const dataKey = series
    .map((e) =>
      [e.day, e.income.bountyIsk, e.income.missionIsk, e.income.corpRewardIsk].join(':'),
    )
    .join('|');

  const containerRef = useAmChart((root, palette) => {
    const chart = root.container.children.push(
      am5xy.XYChart.new(root, {
        panX: false,
        panY: false,
        wheelX: 'none',
        wheelY: 'none',
        layout: root.verticalLayout,
        paddingLeft: 0,
        paddingRight: 0,
      }),
    );

    const xRenderer = am5xy.AxisRendererX.new(root, { minGridDistance: 24 });
    xRenderer.labels.template.setAll({ fill: am5.color(palette.muted), fontSize: 11 });
    xRenderer.grid.template.setAll({ stroke: am5.color(palette.border), strokeOpacity: 0.4 });
    const xAxis = chart.xAxes.push(
      am5xy.CategoryAxis.new(root, { categoryField: 'day', renderer: xRenderer }),
    );
    xAxis.data.setAll(data);

    const yRenderer = am5xy.AxisRendererY.new(root, {});
    yRenderer.labels.template.setAll({ fill: am5.color(palette.muted), fontSize: 11 });
    yRenderer.grid.template.setAll({ stroke: am5.color(palette.border), strokeOpacity: 0.4 });
    const yAxis = chart.yAxes.push(
      am5xy.ValueAxis.new(root, { min: 0, renderer: yRenderer }),
    );

    for (const spec of SERIES) {
      const color = palette[spec.color];
      const seriesInstance = chart.series.push(
        am5xy.ColumnSeries.new(root, {
          name: spec.name,
          xAxis,
          yAxis,
          stacked: true,
          valueYField: spec.value,
          categoryXField: 'day',
          fill: am5.color(color),
          stroke: am5.color(color),
          // The day's total rides along on every segment's tooltip, so a column
          // can be read against the Income tile without adding up segments.
          tooltip: am5.Tooltip.new(root, {
            labelText: `${spec.name}: {${spec.label}}\nDay total: {totalLabel}`,
          }),
        }),
      );
      seriesInstance.columns.template.setAll({
        width: am5.percent(70),
        // A 2px surface-colored stroke separates stacked segments with a gap
        // rather than a border, so touching categories stay distinct.
        stroke: am5.color(palette.panel),
        strokeWidth: 2,
        strokeOpacity: 1,
      });
      seriesInstance.data.setAll(data);
      seriesInstance.appear(600);
    }

    const legend = chart.children.push(
      am5.Legend.new(root, { centerX: am5.percent(50), x: am5.percent(50) }),
    );
    legend.labels.template.setAll({ fill: am5.color(palette.muted), fontSize: 11 });
    legend.data.setAll(chart.series.values);

    chart.appear(600, 100);
  }, dataKey);

  return <div ref={containerRef} className="chart-canvas" data-testid="income-chart-canvas" />;
}
