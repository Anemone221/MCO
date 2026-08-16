import * as am5 from '@amcharts/amcharts5';
import * as am5xy from '@amcharts/amcharts5/xy';
import type { WalletMonthTotals } from '@shared/types';
import { formatIsk, formatMonthLabel } from '../../lib/format';
import { useAmChart } from './useAmChart';

interface ChartDatum {
  /** Month-of-year category label ("Feb 2026"). */
  month: string;
  /** The two income categories are plotted apart so they stack to its total. */
  pve: number;
  corpReward: number;
  donationsIn: number;
  /** Negative, so outgoings stack below the zero line. */
  tax: number;
  expenses: number;
  donationsOut: number;
  pveLabel: string;
  corpRewardLabel: string;
  donationsInLabel: string;
  taxLabel: string;
  expensesLabel: string;
  donationsOutLabel: string;
}

/**
 * Series definitions in stacking order; outgoings carry negative values.
 * Donations reuse one hue in both directions — the side of the zero line
 * already says which way the ISK went — with the outgoing side dimmed, which
 * keeps five hues across six series.
 */
const SERIES = [
  { name: 'Bounties + missions', value: 'pve', label: 'pveLabel', color: 'accent', opacity: 1 },
  { name: 'Reward payouts', value: 'corpReward', label: 'corpRewardLabel', color: 'ok', opacity: 1 },
  { name: 'Donations in', value: 'donationsIn', label: 'donationsInLabel', color: 'warn', opacity: 1 },
  { name: 'Tax', value: 'tax', label: 'taxLabel', color: 'danger', opacity: 1 },
  { name: 'Expenses', value: 'expenses', label: 'expensesLabel', color: 'muted', opacity: 1 },
  {
    name: 'Donations out',
    value: 'donationsOut',
    label: 'donationsOutLabel',
    color: 'warn',
    opacity: 0.5,
  },
] as const;

/**
 * One stacked column per completed month: what came in above the zero line
 * (ratting/mission income, corp reward payouts, donations received) and what
 * went out below it (tax paid, donations sent). Splitting by sign rather than
 * netting keeps a heavily-taxed month visibly different from a quiet one.
 * Chart lifecycle, theming and animation come from useAmChart.
 */
export default function WalletHistoryChart({ months }: { months: WalletMonthTotals[] }) {
  const data: ChartDatum[] = months.map((entry) => {
    const pve = entry.income.bountyIsk + entry.income.missionIsk;
    return {
      month: formatMonthLabel(entry.month),
      pve,
      corpReward: entry.income.corpRewardIsk,
      donationsIn: entry.donationsInIsk,
      tax: -entry.taxIsk,
      expenses: -entry.expenseIsk,
      donationsOut: -entry.donationsOutIsk,
      pveLabel: formatIsk(pve),
      corpRewardLabel: formatIsk(entry.income.corpRewardIsk),
      donationsInLabel: formatIsk(entry.donationsInIsk),
      taxLabel: formatIsk(entry.taxIsk),
      expensesLabel: formatIsk(entry.expenseIsk),
      donationsOutLabel: formatIsk(entry.donationsOutIsk),
    };
  });

  const dataKey = months
    .map((m) =>
      [
        m.month,
        m.income.totalIsk,
        m.income.corpRewardIsk,
        m.taxIsk,
        m.expenseIsk,
        m.donationsInIsk,
        m.donationsOutIsk,
      ].join(':'),
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

    const xRenderer = am5xy.AxisRendererX.new(root, { minGridDistance: 40 });
    xRenderer.labels.template.setAll({ fill: am5.color(palette.muted), fontSize: 11 });
    xRenderer.grid.template.setAll({ stroke: am5.color(palette.border), strokeOpacity: 0.4 });
    const xAxis = chart.xAxes.push(
      am5xy.CategoryAxis.new(root, { categoryField: 'month', renderer: xRenderer }),
    );
    xAxis.data.setAll(data);

    const yRenderer = am5xy.AxisRendererY.new(root, {});
    yRenderer.labels.template.setAll({ fill: am5.color(palette.muted), fontSize: 11 });
    yRenderer.grid.template.setAll({ stroke: am5.color(palette.border), strokeOpacity: 0.4 });
    // No `min: 0` — outgoings are plotted below the zero line.
    const yAxis = chart.yAxes.push(am5xy.ValueAxis.new(root, { renderer: yRenderer }));

    for (const spec of SERIES) {
      const color = palette[spec.color];
      const series = chart.series.push(
        am5xy.ColumnSeries.new(root, {
          name: spec.name,
          xAxis,
          yAxis,
          stacked: true,
          valueYField: spec.value,
          categoryXField: 'month',
          fill: am5.color(color),
          stroke: am5.color(color),
          // The label field holds the unsigned figure, so an outgoing reads as
          // what was paid rather than as a negative number.
          tooltip: am5.Tooltip.new(root, { labelText: `${spec.name}: {${spec.label}}` }),
        }),
      );
      series.columns.template.setAll({
        width: am5.percent(60),
        fillOpacity: spec.opacity,
        // Matches the by-day chart: a 2px surface-colored stroke reads as a gap
        // between stacked segments rather than as a border around them.
        stroke: am5.color(palette.panel),
        strokeWidth: 2,
        strokeOpacity: 1,
      });
      series.data.setAll(data);
      series.appear(600);
    }

    const legend = chart.children.push(
      am5.Legend.new(root, { centerX: am5.percent(50), x: am5.percent(50) }),
    );
    legend.labels.template.setAll({ fill: am5.color(palette.muted), fontSize: 11 });
    legend.data.setAll(chart.series.values);

    chart.appear(600, 100);
  }, dataKey);

  return (
    <div ref={containerRef} className="chart-canvas" data-testid="wallet-history-chart-canvas" />
  );
}
