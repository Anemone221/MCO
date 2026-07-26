import * as am5 from '@amcharts/amcharts5';
import * as am5xy from '@amcharts/amcharts5/xy';
import type { RattedIskDay } from '@shared/types';
import { formatIsk } from '../../lib/format';
import { useAmChart } from './useAmChart';

interface ChartDatum {
  /** Day-of-month category label ("1".."31"). */
  day: string;
  bountyIsk: number;
  missionIsk: number;
  /** Pre-formatted tooltip lines — amCharts' own formatter never sees ISK. */
  bountyLabel: string;
  missionLabel: string;
}

/**
 * Stacked columns of the current month's ratted income, one column per UTC
 * day: bounty income (accent) with mission income (ok-green) stacked on
 * top. Chart lifecycle, theming, and animation come from useAmChart.
 */
export default function IncomeByDayChart({ series }: { series: RattedIskDay[] }) {
  const data: ChartDatum[] = series.map((entry) => ({
    day: String(Number(entry.day.slice(8, 10))),
    bountyIsk: entry.bountyIsk,
    missionIsk: entry.missionIsk,
    bountyLabel: formatIsk(entry.bountyIsk),
    missionLabel: formatIsk(entry.missionIsk),
  }));

  const dataKey = series.map((e) => `${e.day}:${e.bountyIsk}:${e.missionIsk}`).join('|');

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

    const makeSeries = (
      name: string,
      valueField: 'bountyIsk' | 'missionIsk',
      labelField: 'bountyLabel' | 'missionLabel',
      color: string,
    ): void => {
      const seriesInstance = chart.series.push(
        am5xy.ColumnSeries.new(root, {
          name,
          xAxis,
          yAxis,
          stacked: true,
          valueYField: valueField,
          categoryXField: 'day',
          fill: am5.color(color),
          stroke: am5.color(color),
          tooltip: am5.Tooltip.new(root, { labelText: `${name}: {${labelField}}` }),
        }),
      );
      seriesInstance.columns.template.setAll({ strokeOpacity: 0, width: am5.percent(70) });
      seriesInstance.data.setAll(data);
      seriesInstance.appear(600);
    };
    makeSeries('Bounties', 'bountyIsk', 'bountyLabel', palette.accent);
    makeSeries('Missions', 'missionIsk', 'missionLabel', palette.ok);

    const legend = chart.children.push(
      am5.Legend.new(root, { centerX: am5.percent(50), x: am5.percent(50) }),
    );
    legend.labels.template.setAll({ fill: am5.color(palette.muted), fontSize: 11 });
    legend.data.setAll(chart.series.values);

    chart.appear(600, 100);
  }, dataKey);

  return <div ref={containerRef} className="chart-canvas" data-testid="income-chart-canvas" />;
}
