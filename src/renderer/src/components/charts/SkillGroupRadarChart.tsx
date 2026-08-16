import * as am5 from '@amcharts/amcharts5';
import * as am5xy from '@amcharts/amcharts5/xy';
import * as am5radar from '@amcharts/amcharts5/radar';
import type { SkillGroupSp } from '@shared/types';
import { useAmChart } from './useAmChart';

interface RadarDatum {
  /** Skill-group name — the circular-axis category. */
  group: string;
  /** How complete the group is, 0–100, so the radial axis reads "80%". */
  percent: number;
  /** "80.2% — 4,012,345 of 5,000,000 SP", shown in the hover tooltip. */
  detail: string;
}

/**
 * Spider/web radar of how far a character has trained each skill group: skill
 * groups run around the circular axis, the group's completion — trained SP over
 * what the group holds with every skill in it at level V — on the radial axis.
 * So a character holding 4M of Shields' 5M SP reads 80% on that spoke.
 * Completion (not raw SP) keeps the shape comparable between a 5M SP alt and a
 * 200M SP main, and the axis is pinned to 0–100 so the web is comparable
 * between characters too. A single thin line connects the per-group values with
 * a small circular bullet at each spoke; the hover tooltip carries the SP behind
 * the percentage. Lifecycle, theming (palette + Animated theme, skipped under
 * reduced motion) and disposal come from useAmChart.
 */
export default function SkillGroupRadarChart({ groups }: { groups: SkillGroupSp[] }) {
  const data: RadarDatum[] = groups.map((g) => {
    // maxSp counts published skills only, so a character carrying SP in a
    // since-unpublished skill can pass its group's ceiling — plot the cap, and
    // let the tooltip's raw SP show what actually happened.
    const percent = g.maxSp > 0 ? Math.min(100, (g.sp / g.maxSp) * 100) : 0;
    const share = g.maxSp > 0 ? `${percent.toFixed(1)}% — ` : '';
    const ceiling = g.maxSp > 0 ? ` of ${g.maxSp.toLocaleString()}` : '';
    return {
      group: g.group,
      percent,
      detail: `${share}${g.sp.toLocaleString()}${ceiling} SP`,
    };
  });

  const dataKey = groups.map((g) => `${g.group}:${g.sp}:${g.maxSp}`).join('|');

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

    // Radial (value) axis — group completion, from the centre outward. Pinned to
    // a full 0–100 so the web reads as an absolute, and so two characters' webs
    // can be compared by shape rather than each being scaled to its own best group.
    const radialRenderer = am5radar.AxisRendererRadial.new(root, {});
    radialRenderer.labels.template.setAll({ fill: am5.color(palette.muted), fontSize: 10 });
    radialRenderer.grid.template.setAll({
      stroke: am5.color(palette.border),
      strokeOpacity: 0.4,
    });
    const yAxis = chart.yAxes.push(
      am5xy.ValueAxis.new(root, {
        min: 0,
        max: 100,
        strictMinMax: true,
        renderer: radialRenderer,
        // Literal '%' — the values are already 0–100, so amCharts must not scale them.
        numberFormat: "#'%'",
      }),
    );

    // Single line series; the tooltip pairs the percentage with the SP behind it.
    const series = chart.series.push(
      am5radar.RadarLineSeries.new(root, {
        name: 'Group completion',
        xAxis,
        yAxis,
        valueYField: 'percent',
        categoryXField: 'group',
        tooltip: am5.Tooltip.new(root, { labelText: '{group}: {detail}' }),
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
