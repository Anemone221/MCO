import * as am5 from '@amcharts/amcharts5';
import * as am5xy from '@amcharts/amcharts5/xy';
import type { MiningDayTotals } from '@shared/types';
import { formatDayLabel, formatVolumeExact } from '../../lib/format';
import { useAmChart } from './useAmChart';

interface ChartDatum {
  day: string;
  value: number;
  /** Pre-formatted tooltip lines — amCharts' own formatter never sees m³. */
  valueLabel: string;
  unitsLabel: string;
  dayLabel: string;
}

/**
 * Mined volume per UTC day, one column each — the shape of a mining week (or
 * month): which days the fleet undocked, and how the ledger's own ~30-day
 * horizon compares with the history MCO has banked beyond it.
 *
 * One series, not a stack: splitting by ore type would put a dozen classes on a
 * 30-column chart, well past where adjacent colours blur, and the ore split is
 * one click away in the table underneath.
 */
export default function MiningByDayChart({
  series,
  metric,
}: {
  series: MiningDayTotals[];
  /** Units when the imported SDE has no volumes — see `miningMetric`. */
  metric: 'volume' | 'units';
}) {
  const data: ChartDatum[] = series.map((entry) => ({
    day: entry.day,
    value: metric === 'units' ? entry.units : entry.volumeM3,
    valueLabel:
      metric === 'units' ? `${entry.units.toLocaleString()} units` : formatVolumeExact(entry.volumeM3),
    unitsLabel: `${entry.units.toLocaleString()} units`,
    dayLabel: formatDayLabel(entry.day),
  }));

  const dataKey = `${metric}|${series.map((e) => `${e.day}:${e.volumeM3}:${e.units}`).join('|')}`;

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

    const xRenderer = am5xy.AxisRendererX.new(root, { minGridDistance: 44 });
    xRenderer.labels.template.setAll({ fill: am5.color(palette.muted), fontSize: 11 });
    xRenderer.grid.template.setAll({ stroke: am5.color(palette.border), strokeOpacity: 0.4 });
    const xAxis = chart.xAxes.push(
      am5xy.CategoryAxis.new(root, { categoryField: 'dayLabel', renderer: xRenderer }),
    );
    xAxis.data.setAll(data);

    const yRenderer = am5xy.AxisRendererY.new(root, {});
    yRenderer.labels.template.setAll({ fill: am5.color(palette.muted), fontSize: 11 });
    yRenderer.grid.template.setAll({ stroke: am5.color(palette.border), strokeOpacity: 0.4 });
    const yAxis = chart.yAxes.push(am5xy.ValueAxis.new(root, { min: 0, renderer: yRenderer }));

    const columns = chart.series.push(
      am5xy.ColumnSeries.new(root, {
        name: metric === 'units' ? 'Units' : 'Volume',
        xAxis,
        yAxis,
        valueYField: 'value',
        categoryXField: 'dayLabel',
        fill: am5.color(palette.accent),
        stroke: am5.color(palette.accent),
        tooltip: am5.Tooltip.new(root, {
          labelText:
            metric === 'units' ? '{dayLabel}\n{valueLabel}' : '{dayLabel}\n{valueLabel}\n{unitsLabel}',
        }),
      }),
    );
    columns.columns.template.setAll({ width: am5.percent(70) });
    columns.data.setAll(data);
    columns.appear(600);

    chart.appear(600, 100);
  }, dataKey);

  return <div ref={containerRef} className="chart-canvas" data-testid="mining-chart-canvas" />;
}
