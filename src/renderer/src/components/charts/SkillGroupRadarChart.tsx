import * as am5 from '@amcharts/amcharts5';
import * as am5xy from '@amcharts/amcharts5/xy';
import * as am5radar from '@amcharts/amcharts5/radar';
import type { SkillGroupSp } from '@shared/types';
import { useAmChart } from './useAmChart';

interface RadarDatum {
  /** Skill-group name — the circular-axis category. */
  group: string;
  /** Combined SP expressed in millions, so the radial axis reads "12.3M". */
  millions: number;
  /** Exact SP with thousands separators, shown in the hover tooltip. */
  spExact: string;
}

/**
 * Spider/web radar of a character's trained SP by skill group: skill groups run
 * around the circular axis, SP (in millions) on the radial axis. A single thin
 * line connects the per-group values with a small circular bullet at each spoke.
 * The radial axis is labelled in millions to one decimal; the hover tooltip
 * carries the exact SP. Lifecycle, theming (palette + Animated theme, skipped
 * under reduced motion) and disposal come from useAmChart.
 */
export default function SkillGroupRadarChart({ groups }: { groups: SkillGroupSp[] }) {
  const data: RadarDatum[] = groups.map((g) => ({
    group: g.group,
    millions: g.sp / 1_000_000,
    spExact: `${g.sp.toLocaleString()} SP`,
  }));

  const dataKey = groups.map((g) => `${g.group}:${g.sp}`).join('|');

  const containerRef = useAmChart((root, palette) => {
    const chart = root.container.children.push(
      am5radar.RadarChart.new(root, {
        // Drag-panning off; the mouse wheel pans (X) and zooms (Y) instead.
        panX: false,
        panY: false,
        wheelX: 'panX',
        wheelY: 'zoomX',
        radius: am5.percent(80),
      }),
    );

    // Circular axis — one spoke per skill group.
    const circularRenderer = am5radar.AxisRendererCircular.new(root, { minGridDistance: 20 });
    circularRenderer.labels.template.setAll({
      textType: 'adjusted', // keep long group names upright and readable
      fill: am5.color(palette.muted),
      fontSize: 10,
    });
    circularRenderer.grid.template.setAll({
      stroke: am5.color(palette.border),
      strokeOpacity: 0.4,
    });
    const xAxis = chart.xAxes.push(
      am5xy.CategoryAxis.new(root, {
        categoryField: 'group',
        renderer: circularRenderer,
      }),
    );
    // CategoryAxis must receive its own data in addition to the series data.
    xAxis.data.setAll(data);

    // Radial (value) axis — combined SP in millions, from the centre outward.
    const radialRenderer = am5radar.AxisRendererRadial.new(root, {});
    radialRenderer.labels.template.setAll({ fill: am5.color(palette.muted), fontSize: 10 });
    radialRenderer.grid.template.setAll({
      stroke: am5.color(palette.border),
      strokeOpacity: 0.4,
    });
    const yAxis = chart.yAxes.push(
      am5xy.ValueAxis.new(root, {
        min: 0,
        renderer: radialRenderer,
        numberFormat: "#.#'M'", // up to one decimal, in millions of SP
      }),
    );

    // Single line series with the exact SP in its hover tooltip.
    const series = chart.series.push(
      am5radar.RadarLineSeries.new(root, {
        name: 'Skill points',
        xAxis,
        yAxis,
        valueYField: 'millions',
        categoryXField: 'group',
        tooltip: am5.Tooltip.new(root, { labelText: '{group}: {spExact}' }),
      }),
    );
    series.strokes.template.setAll({ strokeWidth: 1, stroke: am5.color(palette.accent) });

    // Small circular bullet at every group intersection.
    series.bullets.push(() =>
      am5.Bullet.new(root, {
        sprite: am5.Circle.new(root, {
          radius: 3,
          fill: am5.color(palette.accent),
          stroke: am5.color(palette.border),
          strokeWidth: 1,
        }),
      }),
    );

    series.data.setAll(data);

    // Cursor for hover tooltips; hide the vertical (radial) guide line, keep the
    // circular value ring. forceHidden survives amCharts re-managing `visible`.
    const cursor = chart.set(
      'cursor',
      am5radar.RadarCursor.new(root, { behavior: 'none' }),
    );
    cursor.lineX.set('forceHidden', true);

    // Animate the series drawing and the chart entrance on load.
    series.appear(1000);
    chart.appear(1000, 100);
  }, dataKey);

  return <div ref={containerRef} className="skill-radar" data-testid="skill-radar-canvas" />;
}
